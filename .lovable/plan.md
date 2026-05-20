Problem: The 48h chart includes a data point one hour in the future. At 21:19, the loop reaches now + 1h (22:00) and pushes a synthesised battery value there, so the line and x-axis extend past the current time.

Root cause: In src/components/BodyBattery48hDialog.tsx, line 73-75 floors now to the current hour, then startMs = now - 47h. Line 168 calculates totalSteps = (48 * 60) / stepMin which creates 192 steps of 15min covering startMs through startMs + 48h = now + 1h. Line 243 pushes an hourly point whenever t % 3600_000 === 0, so 49 hourly points are emitted with the last one at now + 1h. The XAxis uses the categorical label field, so trimming the points array is sufficient, no axis domain change needed.

Fix: In BodyBattery48hDialog.tsx, end the simulation at the current hour rather than one hour ahead. Change line 168 from const totalSteps = (48  *60) / stepMin; to const totalSteps = (47*  60) / stepMin; so the loop runs from now - 47h through now, producing exactly 48 hourly points with the final one at the current hour. As a safety guard, add a break condition in the loop body so any step where t > nowMs is skipped. Add const nowMs = now.getTime(); before the loop, then at the start of the for loop body add if (t > nowMs) break; right after const t = startMs + i * stepMs;.

No other changes needed. Chart anchoring that pins the last point to truth.percent continues to work because the final hourly entry is now the current-hour point. The Now label, drain cards, and AI insight already read from truth and remain untouched. XAxis is categorical so trimming the data array implicitly trims the axis.

Files to edit: src/components/BodyBattery48hDialog.tsx (two line changes described above)

Acceptance: At 21:19, the rightmost x-axis label is 21:00 not 22:00, and the line ends at the Now anchor. Now percentage continues to match the dashboard tile exactly. No other behaviour changes.