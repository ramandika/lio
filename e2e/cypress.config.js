const { defineConfig } = require('cypress')
const { exec } = require('child_process')
const path = require('path')

// Repo root — the reset/tier tasks shell out to the compose stack there
// (docker-compose.yml and scripts/ resolve relative to it).
const REPO_ROOT = path.resolve(__dirname, '..')

// The tasks run inside the app container, where the backend modules own the
// reset and tier rules; Cypress just drives them.
const compose = (cmd) =>
  new Promise((resolve, reject) =>
    exec(`docker compose exec -T ${cmd}`, { cwd: REPO_ROOT }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || stdout || err.message)) : resolve(stdout.trim()),
    ),
  )

module.exports = defineConfig({
  e2e: {
    // The app under test is the real stack — the built SPA served by the
    // FastAPI backend (docker compose up -d, APP_PORT 8020). Override with
    // CYPRESS_BASE_URL (e.g. the Vite dev server at :5173).
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:8020',
    supportFile: 'cypress/support/e2e.js',
    specPattern: 'cypress/e2e/**/*.cy.js',
    screenshotsFolder: 'cypress/screenshots',
    videosFolder: 'cypress/videos',
    fixtureFolder: 'cypress/fixtures',
    // Videos are a local-dev aid — the produced files are gitignored
    // (e2e/cypress/videos/). A red run is diagnosable without repeating
    // it (E2E_TESTING.md).
    screenshotOnRunFailure: true,
    video: true,
    viewportWidth: 1600,
    viewportHeight: 1000,
    setupNodeEvents(on) {
      on('task', {
        // Journeys start from the seeded demo state: request/document rows
        // and uploaded files are wiped, then the demo seed re-applied
        // (scripts/e2e_reset.py inside the app container).
        'db:reset': () => compose('app python scripts/e2e_reset.py'),
        // The LLM tier is an environment switch on the backend (LLM_TIER) —
        // journeys gate their L2 / manual-entry variants on it (specs: J3).
        'llm:tier': () =>
          compose('app python -c "from app import config; print(config.LLM_TIER)"'),
        // J6's "restart the application process": the app container bounces
        // while the db container keeps running — so what answers afterwards
        // can only come from storage, not from process state. The restart
        // resolves once uvicorn answers /health again (the container is up
        // before uvicorn binds, hence the poll).
        'app:restart': async () => {
          await new Promise((resolve, reject) =>
            exec('docker compose restart app', { cwd: REPO_ROOT }, (err, stderr) =>
              err ? reject(new Error(stderr || err.message)) : resolve(),
            ),
          )
          const base = process.env.CYPRESS_BASE_URL || 'http://localhost:8020'
          for (let i = 0; i < 60; i += 1) {
            try {
              const res = await fetch(`${base}/health`)
              if (res.ok) return 'app healthy'
            } catch {
              /* uvicorn still binding — poll on */
            }
            await new Promise((r) => setTimeout(r, 500))
          }
          throw new Error('app did not answer /health within 30s of the restart')
        },
      })
    },
  },
})