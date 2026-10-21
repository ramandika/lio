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

/**
 * Start each test from a clean slate: the shipped app keeps its state in
 * browser storage (see frontend/src/api/mock/server.js), so wiping both
 * seeded accounts' storage is this app's "seeded throwaway DB". The real
 * backend will swap this for a test-database reset; journeys stay unchanged.
 */
Cypress.Commands.add('resetAppData', () => {
  cy.clearLocalStorage() // includes asklio.mockdb.v2 and the session token
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