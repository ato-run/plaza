# Plaza open-air review implementation

Status: implementation draft, 2026-10-10. Extends open-air.md.

All 100 points in the play review are in scope. The implementation keeps one
continuous room and its existing ordered App Room operations. Startup retention,
room ownership, authenticated checkpoints and server commit time remain authoritative.

A human interaction carries its current sanitized pose with the durable operation.
The server requires fresh same-room presence, bounds the pose correction against
that presence, and measures the action against the supplied pose. It never permits
an AI actor to use this lane. Old clients may omit the pose.

Object releases add optional height, vertical velocity, rotation and support ID.
The deterministic fixed-step solver handles gravity, swept furniture collisions,
water skips, bounded current, object support and mass-dependent wind. Support links
are validated against committed positions and cannot form cycles. Old object records
use the original defaults. A renewal extends only the authenticated holder’s lease.
Body pushes, sand marks and repair contributions are bounded committed operations.
NPC work uses deterministic shared time and the same object materialization; no
client-owned autonomous writes or competing clocks are introduced.

Selection uses visibility, object-specific angular tolerance and short hysteresis.
Pending visual feedback is separate from committed feedback. Shared day, weather
and tide remain the conditions for gameplay; personal lighting controls sky, stars
and lamps together. Keyboard remapping, keyboard look, touch controls, FOV and
reduced motion are saved locally.

Acceptance separates automated replay/ownership/physics checks, real browser play,
physical-phone multitouch/resume, three-human cooperation and five first-time
players. The latter three cannot be substituted with scripts or fabricated results.
The pilot goals are first action within 30 seconds, a detour within three minutes,
and two self-directed experiments. No production deployment is included.
