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
  "🦊", "🦦", "🦉", "🐼", "🐧", "🐇", "🐢", "🐬", "🐈",
  "🦝", "🦫", "🐨", "🦭", "🐻", "🦌", "🦔", "🐿️", "🐋",
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
}

const CONTROLS: readonly (readonly [string, string])[] = [
  ["W A S D", "Move"],
  ["Space", "Jump — onto the fountain, too"],
  ["C / Ctrl", "Crouch"],
  ["E", "Interact with what you are facing"],
  ["Enter", "Talk to people nearby"],
  ["1 – 4", "React to the person you are facing"],
  ["M", "Open this menu"],
];

export function PlazaMenu(props: PlazaMenuProps) {
  const { open, focus, identity } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [animal, setAnimal] = useState<string>(ROOM_ANIMALS[0]);

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
    !!identity && (trimmed !== identity.displayName || animal !== identity.animalEmoji);
  const valid = nameLength >= 1 && nameLength <= MAX_NAME_CHARS;
  const lookKeys = props.lookMode === "drag" ? "Drag" : "Mouse";

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
          <button type="button" className="pg-menu-close" onClick={props.onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <section data-section="profile">
          <h3>You</h3>
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
              <p className="pg-menu-note">Your name can be changed once you are connected.</p>
            ) : null}
          </form>
        </section>

        {times ? (
          <section data-section="time">
            <h3>Time of day</h3>
            <div className="pg-time" role="group" aria-label="Time of day">
              {times.map((entry, index) => {
                const active = (props.timeOfDay ?? times[0]?.id) === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={active}
                    className={active ? "pg-time-on" : undefined}
                    onClick={() => props.onTimeOfDay(index === 0 ? null : entry.id)}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
            <p className="pg-menu-note">Only you see this; everyone picks their own.</p>
          </section>
        ) : null}

        <section data-section="world">
          <h3>Worlds</h3>
          <ul className="pg-menu-worlds">
            {props.worlds.map((definition) => {
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
        </section>

        <section data-section="controls">
          <h3>Controls</h3>
          <dl className="pg-controls">
            {CONTROLS.map(([keys, action]) => (
              <div key={keys}>
                <dt>
                  <kbd>{keys}</kbd>
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
