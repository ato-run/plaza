(function () {
  "use strict";
  if (window.atoStartup) return;
  var MAX_DEFERRED_TASKS = 32;

  var milestones = Object.create(null), connection = null;
  var work = Object.create(null);
  var retention = null;
  function registerRetention(contract) {
    if (!contract || ["suspend", "resume", "memoryBytes"].some(function (key) { return typeof contract[key] !== "function"; }))
      throw new TypeError("Expected suspension, resumption and memory estimate callbacks");
    retention = Object.freeze({ suspend: contract.suspend, resume: contract.resume, memoryBytes: contract.memoryBytes });
    var registered = retention;
    return function () { if (retention === registered) retention = null; };
  }
  function measure(stage, duration) {
    if (typeof stage !== "string" || !/^[a-z-]{1,32}$/.test(stage) ||
        typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) throw new TypeError("Invalid startup work timing");
    if (Object.keys(work).length < 8) work[stage] = duration;
  }
  var phases = ["script-ready", "first-render", "interactive", "connected", "first-action", "complete"];
  function snapshot() {
    var resources = typeof performance.getEntriesByType === "function" ? performance.getEntriesByType("resource") : [];
    var groups = {};
    resources.forEach(function (entry) {
      // Query strings, origins and filenames never leave the app document.
      var path = entry.name.split("?")[0];
      var kind = /\.m?js$/.test(path) ? "script" : /\.(glb|gltf)$/.test(path) ? "model" : /\.(png|jpe?g|webp|ktx2?)$/.test(path) ? "texture" : "other";
      var group = groups[kind] || (groups[kind] = { count: 0, transfer_bytes: 0, decoded_bytes: 0, cached: 0, unknown: 0, max_duration_ms: 0 });
      group.count++; group.transfer_bytes += entry.transferSize || 0; group.decoded_bytes += entry.decodedBodySize || 0;
      if (entry.transferSize === 0 && entry.decodedBodySize > 0) group.cached++;
      if (!entry.transferSize && !entry.decodedBodySize) group.unknown++;
      group.max_duration_ms = Math.max(group.max_duration_ms, entry.duration || 0);
    });
    var nav = typeof performance.getEntriesByType === "function" ? performance.getEntriesByType("navigation")[0] : null;
    return { resources: groups, work: Object.assign({}, work), document: nav ? {
      response_start_ms: nav.responseStart, response_end_ms: nav.responseEnd,
      dom_interactive_ms: nav.domInteractive, load_ms: nav.loadEventEnd,
      transfer_bytes: nav.transferSize, decoded_bytes: nav.decodedBodySize
      , network: ["workerStart", "fetchStart", "redirectStart", "redirectEnd", "domainLookupStart", "domainLookupEnd", "connectStart", "connectEnd", "secureConnectionStart", "requestStart", "responseStart", "responseEnd", "duration"].reduce(function (out, key) {
        if (Number.isFinite(nav[key]) && nav[key] >= 0) out[key] = nav[key]; return out;
      }, {}),
      server: (nav.serverTiming || []).filter(function (item) { return /^ato_[a-z_]{1,64}$/.test(item.name); }).slice(0,40).map(function (item) {
        var value = { name: item.name, duration: item.duration };
        if (/^ato_(trace|request|queries|db_calls)$/.test(item.name) && /^[0-9a-f-]{1,36}$/i.test(item.description)) value.description = item.description;
        return value;
      })
    } : null };
  }
  function send(phase) {
    if (!connection) return;
    connection.source.postMessage({ protocol: "ato.startup.v1", type: "milestone",
      channel: connection.channel, phase: phase, at_ms: milestones[phase], time_origin_ms: performance.timeOrigin, telemetry: snapshot()
    }, connection.origin);
  }
  function mark(phase) {
    if (phases.indexOf(phase) < 0) throw new TypeError("Unknown startup milestone");
    if (milestones[phase] !== undefined) return;
    milestones[phase] = performance.now();
    if (typeof performance.mark === "function") performance.mark("ato:app:" + phase);
    send(phase);
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!window.parent || window.parent === window || event.source !== window.parent ||
        !/^https?:\/\//.test(event.origin) || data?.protocol !== "ato.startup.v1" || data.type !== "connect" ||
        typeof data.channel !== "string" || data.channel.length > 80 || !data.channel.length) return;
    connection = { source: event.source, origin: event.origin, channel: data.channel };
    phases.forEach(function (phase) { if (milestones[phase] !== undefined) send(phase); });
  });
  mark("script-ready");
  if (window.parent && window.parent !== window) window.parent.postMessage({ protocol: "ato.startup.v1", type: "available" }, "*");

  function cancelled(signal) {
    if (signal.aborted) throw signal.reason;
  }

  // Abort stops awaiting an uncooperative callback as well as queued work.
  // Its in-flight fetch/worker must use the supplied signal to stop its work.
  function awaitTask(task, context) {
    return new Promise(function (resolve, reject) {
      function abort() { reject(context.signal.reason); }
      if (context.signal.aborted) { abort(); return; }
      context.signal.addEventListener("abort", abort, { once: true });
      Promise.resolve().then(function () {
        cancelled(context.signal);
        return task(context);
      }).then(resolve, reject).finally(function () {
        context.signal.removeEventListener("abort", abort);
      });
    });
  }

  // A rendering opportunity and a separate task precede every optional unit.
  // Hidden documents wait rather than downloading/initializing optional work.
  function yieldToBrowser(signal) {
    return new Promise(function (resolve, reject) {
      var frame = null, timer = null;
      function cleanup() {
        if (frame !== null) cancelAnimationFrame(frame);
        if (timer !== null) clearTimeout(timer);
        document.removeEventListener("visibilitychange", schedule);
        signal.removeEventListener("abort", abort);
      }
      function abort() { cleanup(); reject(signal.reason); }
      function schedule() {
        if (document.hidden || frame !== null || timer !== null) return;
        frame = requestAnimationFrame(function () {
          frame = null;
          timer = setTimeout(function () {
            timer = null;
            if (document.hidden) return;
            cleanup();
            resolve();
          }, 0);
        });
      }
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      document.addEventListener("visibilitychange", schedule);
      schedule();
    });
  }

  function run(options) {
    var tasks = options && options.deferred || [];
    if (!options || typeof options.critical !== "function" || !Array.isArray(tasks) ||
        tasks.length > MAX_DEFERRED_TASKS || tasks.some(function (task) { return typeof task !== "function"; }))
      throw new TypeError("Expected critical callback and at most 32 deferred callbacks");
    if (options.signal && !(options.signal instanceof AbortSignal))
      throw new TypeError("Expected AbortSignal");
    tasks = tasks.slice();
    var externalSignal = options.signal;
    var controller = new AbortController();
    var signal = controller.signal;
    var startedAt = performance.now();
    var critical = options.critical;
    function cancel() { controller.abort(new DOMException("Startup cancelled", "AbortError")); }
    function forwardAbort() { controller.abort(externalSignal.reason); }
    function report(phase) {
      // App-reported timing, never a verification receipt or usage confirmation.
      window.dispatchEvent(new CustomEvent("ato:startup", { detail: {
        protocol: "ato.startup.v1", phase: phase, elapsed_ms: performance.now() - startedAt
      } }));
    }
    if (externalSignal) {
      if (externalSignal.aborted) forwardAbort();
      else externalSignal.addEventListener("abort", forwardAbort, { once: true });
    }
    window.addEventListener("pagehide", cancel, { once: true });
    var context = Object.freeze({ signal: signal, yield: function () { return yieldToBrowser(signal); } });
    var ready = awaitTask(critical, context).then(function (value) {
      cancelled(signal);
      report("critical-ready");
      return value;
    });
    var finished = ready.then(async function () {
      for (var task of tasks) {
        await yieldToBrowser(signal);
        await awaitTask(task, context);
      }
      cancelled(signal);
      report("complete");
      mark("complete");
    }).catch(function (error) {
      report(signal.aborted ? "cancelled" : "failed");
      throw error;
    }).finally(function () {
      window.removeEventListener("pagehide", cancel);
      if (externalSignal) externalSignal.removeEventListener("abort", forwardAbort);
    });
    // Consumers may await just one promise. Both still reject for their callers.
    ready.catch(function () {});
    finished.catch(function () {});
    return Object.freeze({ ready: ready, finished: finished, cancel: cancel });
  }
  window.atoStartup = Object.freeze({ version: 1, run: run, mark: mark, measure: measure,
    registerRetention: registerRetention,
    get retention() { return milestones.complete !== undefined ? retention : null; }
  });
})();
