/*
 * The mock keeps its own commodity view only as a re-export of the shared
 * reference list (src/data/commodity.js) — the list is data, not mock
 * behavior. The whole mock transport is dormant: it runs only when
 * `useMock` is flipped true in api/index.js.
 */

export { COMMODITY_GROUPS, COMMODITY_BY_ID, commodity } from '../../data/commodity'