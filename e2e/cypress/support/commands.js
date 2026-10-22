/*
 * Journey helpers. Journeys are independent and order-insensitive
 * (docs/E2E_TESTING.md principles 3-4): each journey starts from a known
 * empty state and creates its own requests under a run-unique title
 * prefix ("worker namespace"), so parallel or repeated runs never collide.
 */

/**
 * A namespace unique to this run. Tests suffixed their created data with it;
 * combined with the per-test wipe below this keeps runs deterministic.
 */
const RUN_PREFIX = `E2E ${new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '')} #${Math.floor(Math.random() * 1000)}`

Cypress.Commands.add('runPrefix', () => RUN_PREFIX)

/** Seeded request ids — the backend's fixed demo UUIDs (app/seed.py).
 * r1 Adobe — In Progress · r2 Standing Desks — Open · r3 Insurance — Closed. */
const SEEDED_REQUEST_IDS = {
  r1: '00000000-0000-4000-8000-000000000001',
  r2: '00000000-0000-4000-8000-000000000002',
  r3: '00000000-0000-4000-8000-000000000003',
}
Cypress.Commands.add('seededId', (name) => SEEDED_REQUEST_IDS[name])

/**
 * Start each test from a known state: request/document rows and uploaded
 * files are wiped, then the demo seed re-applied — inside the app container
 * (e2e_reset.py, wired to the `db:reset` task in cypress.config.js). Users
 * and sessions stay; journeys sign in through the login form.
 */
Cypress.Commands.add('resetAppData', () => {
  cy.task('db:reset', { timeout: 60_000 })
  cy.clearLocalStorage() // the theme toggle and any per-viewer conveniences
})

/**
 * Sign in the way a user does — through the login form, asserting the app
 * reaches the workbench.
 */
Cypress.Commands.add('signIn', (email = 'ana@example.com', password = 'demo') => {
  cy.visit('/login')
  cy.findByLabelText('Email').type(email)
  cy.findByLabelText('Password').type(password)
  cy.findByRole('button', { name: 'Sign In' }).click()
  // Signed in: the workbench rail is up (unique label — "Add Request" appears
  // in two places, so the search input anchors the "app is ready" moment).
  cy.findByLabelText('Search requests').should('be.visible')
})

/**
 * Open the intake form via the Add Request affordance in the request rail.
 */
Cypress.Commands.add('openNewRequest', () => {
  cy.findByRole('button', { name: '+ Add Request' }).click()
})
