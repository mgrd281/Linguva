/**
 * Test-file setup of the rehearsal (vitest.live-rehearsal.config.ts): every
 * live test file talks to its own fresh rehearsal store.
 */
import { installRehearsalFetch, rehearsalShape, rehearsalStore } from "./rehearsal";

installRehearsalFetch(rehearsalStore(rehearsalShape()));
