# Relative Camera Target Offset

Status: accepted

In look-at cameras, absolute world-coordinate targets cause camera translation to inadvertently pivot or rotate the viewing angle toward a stationary point. We decided to store and author camera aiming as a relative `targetOffset` vector `(dx, dy, dz)` from the camera position rather than an absolute world point `target`. This decouples translation from rotation: moving the camera's position preserves its line of sight without side effects, while moving the target offset adjusts orientation. Legacy projects with absolute `target` coordinates are automatically migrated on read to `targetOffset = target - position`.
