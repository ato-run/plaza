import { interactionMeasurements } from "./world/openAir/metrics";
import { OPEN_AIR_PLACES } from "./world/openAir/layout";
import {
  DEFAULT_KEYS,
  rebindKey,
  type InputAction,
  type ExploreSettings,
} from "./world/openAir/settings";
/**
 * The one place that explains and changes how you are in the Plaza: who you
 * appear as, the light you see, which World you are in, and the controls.
 *
 * Opened from the Menu button or M. While it is open the
 * world is paused, so keys typed into the name field never walk you around.
 */
import { useEffect, useRef, useState } from "react";

import type { WorldDefinition, WorldId } from "./world/types";

/** The room's animals — the same list the room validates a choice against. */
export const ROOM_ANIMALS = [
  "🦊",
  "🦦",
  "🦉",
  "🐼",
  "🐧",
  "🐇",
  "🐢",
  "🐬",
  "🐈",
  "🦝",
  "🦫",
  "🐨",
  "🦭",
  "🐻",
  "🦌",
  "🦔",
  "🐿️",
  "🐋",
] as const;

/** Longest name the room accepts, in characters. */
export const MAX_NAME_CHARS = 24;

export type MenuSection = "profile" | "world" | "controls";

interface PlazaMenuProps {
  open: boolean;
  focus: MenuSection;
  onClose(): void;
  /** Null while the room has not said who you are yet. */
  identity: { displayName: string; animalEmoji: string } | null;
  /** False when this room cannot take a name change (offline, AI lane). */
  canEditIdentity: boolean;
  connected: boolean;
  onSaveIdentity(displayName: string, animalEmoji: string): void;
  worlds: readonly WorldDefinition[];
  worldId: WorldId;
  worldOnline: Partial<Record<WorldId, number>>;
  /** People in this room right now (the World you are in). */
  online: number;
  onEnterWorld(id: WorldId): void;
  timeOfDay: string | null;
  onTimeOfDay(id: string | null): void;
  lookMode: "lock" | "drag";
  settings?: ExploreSettings;
  onSettings?(settings: ExploreSettings): void;
  onPlace?(id: string): void;
}

const CONTROLS: readonly (readonly [string, string])[] = [
  ["W A S D", "Move"],
  ["Space", "Jump / climb low ledges"],
  ["C / Ctrl", "Crouch"],
  ["Shift", "Run"],
  ["E", "Pick up objects, watch wildlife, use seats or exhibits"],
  ["Enter", "Talk to people, residents or Nagi"],
  ["1 – 4", "React to whoever you are facing"],
  ["Q / F", "Place / throw the object you are holding"],
  ["R / G", "Rotate the held object / draw in sand"],
  ["M", "Open this menu"],
];

export function PlazaMenu(props: PlazaMenuProps) {
  const { open, focus, identity } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [animal, setAnimal] = useState<string>(ROOM_ANIMALS[0]);
  const [keyError, setKeyError] = useState("");

  // Start each opening from what the room currently calls you.
  useEffect(() => {
    if (!open) return;
    setName(identity?.displayName ?? "");
    setAnimal(identity?.animalEmoji ?? ROOM_ANIMALS[0]);
    const section = dialogRef.current?.querySelector<HTMLElement>(
      `[data-section="${focus}"]`,
    );
    if (focus === "profile") dialogRef.current?.scrollTo(0, 0);
    else section?.scrollIntoView({ block: "start" });
    // Take focus so keys go to the menu (and Esc closes it) however it opened.
    dialogRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const world = props.worlds.find((entry) => entry.id === props.worldId);
  const times = world?.environment.timesOfDay;
  const trimmed = name.replace(/\s+/g, " ").trim();
  const nameLength = [...trimmed].length;
  const changed =
    !!identity &&
    (trimmed !== identity.displayName || animal !== identity.animalEmoji);
  const valid = nameLength >= 1 && nameLength <= MAX_NAME_CHARS;
  const lookKeys = props.lookMode === "drag" ? "Drag" : "Mouse";
  const shortcuts: Record<string, InputAction[]> = {
    "W A S D": ["forward", "left", "back", "right"],
    Space: ["jump"],
    "C / Ctrl": ["crouch"],
    Shift: ["run"],
    E: ["interact"],
    "Q / F": ["place", "throw"],
    "R / G": ["rotate", "mark"],
  };
  const keyLabel = (label: string) =>
    shortcuts[label]
      ?.map((action) =>
        (props.settings?.keys ?? DEFAULT_KEYS)[action]
          .replace("Key", "")
          .replace("ShiftLeft", "Shift")
          .replace("ShiftRight", "Right Shift"),
      )
      .join(" / ") ?? label;

  return (
    <>
      <button
        type="button"
        className="pg-selector-backdrop"
        aria-label="Close menu"
        onClick={props.onClose}
      />
      <div
        ref={dialogRef}
        className="pg-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        onKeyDown={(event) => {
          // Keys typed here belong to the menu, never to walking.
          event.stopPropagation();
          if (event.key === "Escape") props.onClose();
        }}
      >
        <header className="pg-menu-head">
          <h2>Menu</h2>
          <button
            type="button"
            className="pg-menu-close"
            onClick={props.onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <section data-section="profile">
          <h3>You</h3>
          <p className="pg-menu-self">
            <span aria-hidden="true">{identity?.animalEmoji ?? "…"}</span>
            <strong>{identity?.displayName ?? "Connecting"}</strong>
            <small>{props.connected ? "In the plaza" : "Reconnecting…"}</small>
          </p>
          <form
            className="pg-profile"
            onSubmit={(event) => {
              event.preventDefault();
              if (changed && valid) props.onSaveIdentity(trimmed, animal);
            }}
          >
            <div className="pg-animals" role="radiogroup" aria-label="Animal">
              {ROOM_ANIMALS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="radio"
                  aria-checked={animal === emoji}
                  className={animal === emoji ? "pg-animal-on" : undefined}
                  disabled={!props.canEditIdentity}
                  onClick={() => setAnimal(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <label className="pg-profile-name">
              <span>Name</span>
              <input
                value={name}
                maxLength={MAX_NAME_CHARS * 2}
                disabled={!props.canEditIdentity}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={props.canEditIdentity && !valid}
              />
              <small>
                {nameLength}/{MAX_NAME_CHARS}
              </small>
            </label>
            <button
              type="submit"
              className="pg-profile-save"
              disabled={!props.canEditIdentity || !changed || !valid}
            >
              Save
            </button>
            {!props.canEditIdentity ? (
              <p className="pg-menu-note">
                Your name can be changed once you are connected.
              </p>
            ) : null}
          </form>
        </section>

        {times ? (
          <section data-section="time">
            <h3>Lighting</h3>
            <div className="pg-time" role="group" aria-label="Time of day">
              <button
                type="button"
                role="checkbox"
                aria-checked={props.timeOfDay === null}
                className={props.timeOfDay === null ? "pg-time-on" : undefined}
                onClick={() => props.onTimeOfDay(null)}
              >
                Shared clock
              </button>
              {times.map((entry) => {
                const active = props.timeOfDay === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={active}
                    className={active ? "pg-time-on" : undefined}
                    onClick={() => props.onTimeOfDay(entry.id)}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
            <p className="pg-menu-note">
              Lighting overrides affect only your view. Tide, weather and
              neighbors follow the shared clock.
            </p>
          </section>
        ) : null}

        <section data-section="world">
          <h3>Places</h3>
          <div className="pg-guide-choices">
            {OPEN_AIR_PLACES.map((place) => (
              <button key={place.id} onClick={() => props.onPlace?.(place.id)}>
                Show route to {place.name}
              </button>
            ))}
          </div>
          {props.worlds.filter((definition) => definition.available).length >
          1 ? (
            <ul className="pg-menu-worlds">
              {props.worlds
                .filter((definition) => definition.available)
                .map((definition) => {
                  const count = props.worldOnline[definition.id];
                  const here = definition.id === props.worldId;
                  return (
                    <li key={definition.id}>
                      <button
                        type="button"
                        className={`pg-selector-item${here ? " pg-selector-item--here" : ""}`}
                        disabled={!definition.available || here}
                        onClick={() => props.onEnterWorld(definition.id)}
                      >
                        <span className="pg-selector-index">
                          {String(definition.index).padStart(2, "0")}
                        </span>
                        <span className="pg-selector-body">
                          <strong>{definition.name}</strong>
                          <small>{definition.tagline}</small>
                        </span>
                        <span className="pg-selector-count">
                          {!definition.available
                            ? "Coming soon"
                            : here
                              ? `You are here · ${props.online} online`
                              : /* An absent count is not zero: a server without
                               per-World counts would otherwise report every
                               World as empty. */
                                typeof count === "number"
                                ? `${count} here`
                                : "—"}
                        </span>
                      </button>
                    </li>
                  );
                })}
            </ul>
          ) : null}
        </section>

        <section data-section="controls">
          {import.meta.env.DEV ? (
            <details>
              <summary>Input measurements</summary>
              <table>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Samples</th>
                    <th>Median ms</th>
                    <th>P95 ms</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(interactionMeasurements()).map(
                    ([kind, value]) => (
                      <tr key={kind}>
                        <td>{kind}</td>
                        <td>{value.count}</td>
                        <td>{value.medianMs.toFixed(1)}</td>
                        <td>{value.p95Ms.toFixed(1)}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </details>
          ) : null}
          <h3>Controls</h3>
          {props.settings && props.onSettings ? (
            <div className="pg-view-settings">
              <label>
                Look sensitivity{" "}
                <input
                  type="range"
                  min="0.2"
                  max="2"
                  step="0.05"
                  value={props.settings.sensitivity}
                  onChange={(event) =>
                    props.onSettings?.({
                      ...props.settings!,
                      sensitivity: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={props.settings.invertY}
                  onChange={(event) =>
                    props.onSettings?.({
                      ...props.settings!,
                      invertY: event.target.checked,
                    })
                  }
                />{" "}
                Invert vertical look
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={props.settings.motion}
                  onChange={(event) =>
                    props.onSettings?.({
                      ...props.settings!,
                      motion: event.target.checked,
                    })
                  }
                />{" "}
                Walking camera motion
              </label>
              <label>
                Field of view{" "}
                <input
                  type="range"
                  min="50"
                  max="95"
                  step="1"
                  value={props.settings.fov}
                  onChange={(event) =>
                    props.onSettings?.({
                      ...props.settings!,
                      fov: Number(event.target.value),
                    })
                  }
                />
              </label>
              <details>
                <summary>Keyboard controls</summary>
                <p>
                  Arrow keys look around. Select a control and press its new
                  key.
                </p>
                {(Object.keys(DEFAULT_KEYS) as InputAction[]).map((action) => (
                  <label key={action}>
                    {action.replace(/([A-Z])/g, " $1")}
                    <button
                      onKeyDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.code === "Escape" || event.code === "Enter")
                          return;
                        const keys = rebindKey(
                          props.settings!.keys,
                          action,
                          event.code,
                        );
                        if (!keys) {
                          setKeyError(
                            "Choose an unused letter, arrow, Space or Shift. M, Enter and 1–4 are reserved.",
                          );
                          return;
                        }
                        setKeyError("");
                        props.onSettings?.({ ...props.settings!, keys });
                      }}
                    >
                      {props.settings!.keys[action].replace("Key", "")}
                    </button>
                  </label>
                ))}
                <button
                  onClick={() =>
                    props.onSettings?.({
                      ...props.settings!,
                      keys: { ...DEFAULT_KEYS },
                    })
                  }
                >
                  Reset keys
                </button>
                {keyError ? <p role="status">{keyError}</p> : null}
              </details>
              <label>
                Sound volume{" "}
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={props.settings.volume}
                  onChange={(event) =>
                    props.onSettings?.({
                      ...props.settings!,
                      volume: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
          ) : null}
          <dl className="pg-controls">
            {CONTROLS.map(([keys, action]) => (
              <div key={keys}>
                <dt>
                  <kbd>{keyLabel(keys)}</kbd>
                </dt>
                <dd>{action}</dd>
              </div>
            ))}
            <div>
              <dt>
                <kbd>{lookKeys}</kbd>
              </dt>
              <dd>Look around</dd>
            </div>
            <div>
              <dt>
                <kbd>Esc</kbd>
              </dt>
              <dd>Release the view</dd>
            </div>
          </dl>
          <p className="pg-menu-note">
            On touch screens: the left stick moves, drag the right side to look,
            and the buttons jump and crouch.
          </p>
        </section>
      </div>
    </>
  );
}
