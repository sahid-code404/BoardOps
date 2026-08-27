# Task: DIGITAL-CLOCK-PICKER — Digital Clock Picker

## Summary
Built a reusable popover-based digital clock face time picker and swapped out the
dropdown-based `TimePicker12` used in the meal config form. Also confirmed there
were no native `<input type="time">` elsewhere in `src/components/`.

## Files
- NEW: `src/components/ui/digital-clock-picker.tsx`
- EDITED: `src/components/features/meals/meals-config-view.tsx`

## Component API
```tsx
<DigitalClockPicker
  value="08:00"            // "HH:mm" 24-hour
  onChange={(v) => ...}    // receives "HH:mm" 24-hour
  label="Service start"    // optional
  error="..."              // optional
/>
```
Display is always 12-hour AM/PM; storage/onChange is always 24-hour "HH:mm".

## Design notes
- Glass trigger button (rounded-2xl, `.glass`), shows time + Clock icon + "24h" hint
- Popover: `.glass-strong`, 280px wide, mobile-safe `max-w-[calc(100vw-2rem)]`
- Header: big live time + primary "Done" button
- AM/PM segmented toggle (glass-soft track)
- Tabs (Hour | Minute) using shadcn `Tabs`
- 4×3 grid for hours (1-12) and minutes (00,05,...,55)
- Selected cell = `bg-primary text-primary-foreground`; CSS-only transitions
- Popover stays open after selecting a cell; closes on Done or outside click

## Lint
`bun run lint` → 0 errors. Only pre-existing
`react-hooks/incompatible-library` warnings about react-hook-form's `watch()` remain
(same pattern already existed before this change).
