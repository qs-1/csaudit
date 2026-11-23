# Contributing

Thanks for helping. Anything that makes the app more correct for FCCU CS students is welcome.

## Quick start

```sh
npm install
npm run dev     # http://localhost:5173
npm test        # run before opening a pull request
```

## Good first contributions

- **A wrong requirement or credit count.** Open an issue with your batch and what the official checklist says, or fix the batch's file in `src/data/programs/` yourself.
- **A transcript that doesn't read properly.** Open an issue describing what went wrong. Don't attach your real transcript; remove your name and ID first.
- **A new batch's checklist.** Copy the nearest file in `src/data/programs/`, update it, and add it to `src/data/registry.ts`. The tests check it against the catalog.

## Pull requests

- Keep each one to a single change.
- Run `npm test` and make sure it passes.
- For UI changes, add a screenshot showing desktop and phone.

Section lists update on their own every few hours, so you don't need to touch `src/data/terms/`.
