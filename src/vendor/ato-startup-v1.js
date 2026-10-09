(function () {
  "use strict";
  if (window.atoStartup) return;
  var MAX_DEFERRED_TASKS = 32;

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
  window.atoStartup = Object.freeze({ version: 1, run: run });
})();
