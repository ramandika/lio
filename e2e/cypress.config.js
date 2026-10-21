const { defineConfig } = require('cypress')

module.exports = defineConfig({
  e2e: {
    // The app under test is started the documented way users run it —
    // `npm run dev` in frontend/ (the mock-API backend is the shipped app
    // until the FastAPI request endpoints land). Override with
    // CYPRESS_BASE_URL when the frontend is wired to the real stack.
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:5173',
    supportFile: 'cypress/support/e2e.js',
    specPattern: 'cypress/e2e/**/*.cy.js',
    screenshotsFolder: 'cypress/screenshots',
    videosFolder: 'cypress/videos',
    fixtureFolder: 'cypress/fixtures',
    // A red run is diagnosable without repeating it (E2E_TESTING.md).
    screenshotOnRunFailure: true,
    video: Boolean(process.env.CI),
    viewportWidth: 1600,
    viewportHeight: 1000,
  },
})