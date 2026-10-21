/*
 * J3 — Offer upload → auto-fill → submit (docs/E2E_TESTING.md).
 *
 * The extraction feature from README challenge 1, step "upload a document,
 * which then auto-fills the request", exercised from the outside. The
 * two-layer composite is honest about its layers: the README verbatim offer
 * resolves at L1 deterministically (zero LLM calls — the documented L1
 * design point), while an unseen offer format triggers L2 — the
 * llm_ocr_fuse extraction against the local OpenAI-compatible server
 * (no API key). Its negative variants cover the partial document (missing
 * totals stay flagged "not detected") and the AI-unavailable degradation to
 * manual entry.
 */

// The L2 variants run live against the local LLM server — whole-journey
// timeouts ride on the first wait after the upload (per-command timeouts
// reset after that; extraction usually answers in well under a minute).
const LLM_WAIT = 300_000

const OFFER = {
  vendor: 'Global Tech Solutions',
  vatId: 'DE987654321',
  department: 'Creative Marketing Department',
  lines: [
    // `total` is the form's decimal value; `sheetTotal` is the formatted money
    // the document sheet shows (Intl grouping).
    { description: 'Adobe Photoshop License', price: '150.00', amount: '10', total: '1500.00', sheetTotal: '€1,500.00' },
    { description: 'Adobe Illustrator License', price: '120.00', amount: '5', total: '600.00', sheetTotal: '€600.00' },
  ],
  total: '2100.00',
}

const DETECTED = ['Vendor Name', 'VAT ID', 'Department', 'Order Lines', 'Total Cost']

function uploadOffer(fixture) {
  // 1. New request → upload the offer document (the fixture's basename
  // travels as the filename).
  cy.openNewRequest()
  cy.url().should('include', 'selected=new')
  cy.findByRole('heading', { name: 'Have a Vendor Offer?' }).should('be.visible')
  // The input is visually hidden under the "Upload Offer" pill (native file
  // dialogs can't be driven by Cypress); the aria-labelled input is the
  // accessible upload affordance, so the file is attached to it directly.
  cy.findByLabelText('Upload offer document').selectFile(fixture, { force: true })
}

function assertDetectedSummary() {
  // 3. The extraction summary names the detected fields — each one carries
  // its check mark, and nothing ended up flagged as not detected.
  DETECTED.forEach((label) => cy.contains(label).should('be.visible'))
  cy.contains('not detected').should('not.exist')
}

function assertPrefilledForm() {
  // 4. The form is pre-filled to match the README's "Extracted Information":
  // vendor, VAT ID, department, both order lines, the total cost.
  cy.findByLabelText('Vendor Name').should('have.value', OFFER.vendor)
  cy.findByLabelText(/VAT ID/).should('have.value', OFFER.vatId)
  cy.findByLabelText('Department').should('have.value', OFFER.department)
  OFFER.lines.forEach((line, i) => {
    const n = i + 1
    cy.findByLabelText(`Line ${n} Description`).should('have.value', line.description)
    cy.findByLabelText(`Line ${n} Unit Price`).should('have.value', line.price)
    cy.findByLabelText(`Line ${n} Amount`).should('have.value', line.amount)
    cy.findByLabelText(`Line ${n} Line Total`).should('have.value', line.total)
  })
  cy.findByLabelText('Total Cost').should('have.value', OFFER.total)
}

function assertCommoditySuggestion() {
  // 5. The extraction also produced a commodity group suggestion — the user
  // was never asked to pick it. The card sits at the pane's fold in this
  // viewport, so it is scrolled into view first (the visible state a user
  // would reach by scrolling).
  cy.contains('h3', 'Commodity Group').scrollIntoView().should('be.visible')
  cy.findByText('High Confidence').should('be.visible')
  cy.contains('Information Technology · Software').should('be.visible')
}

function assertSavedRequest(title, unit = 'pieces') {
  // 6. Submit → request persisted; 7. the detail view shows the extracted
  // values verbatim (scoped to the document sheet — names like the requestor
  // also appear in the nav bar). `unit` null means "whatever the document
  // stated" — asserted non-empty only.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // titles carry "("…
  cy.url().should('match', /selected=r\d+/)
  const overviewRow = cy.findByRole('button', {
    name: new RegExp(
      `${esc(title)}[\\s\\S]*${esc(OFFER.vendor)}[\\s\\S]*€\\s?2,100\\.00`,
    ),
  })
  overviewRow.should('contain.text', 'Open')

  // With an uploaded document the app lands that view on the "Offer
  // Document" tab and the user reads the request on the "Request Sheet" tab;
  // a request without an attached document renders the sheet directly, with
  // no tab bar. Wait until the view has switched (retry: the URL changes a
  // beat before the render), then switch tabs only when they exist — a plain
  // body read here races the render, and both cases occur in this spec.
  cy.get('body').should(($body) => {
    expect(
      $body.find('[role="tab"]').length > 0 || $body.find('.sheet__title').length > 0,
    ).to.be.true
  })
  cy.get('body').then(($body) => {
    if ($body.find('[role="tab"]').length > 0) {
      cy.contains('[role="tab"]', 'Request Sheet').click()
    }
  })

  cy.findByRole('heading', { name: title }).should('be.visible')
  cy.findByText(/Requested by/)
    .closest('article')
    .within(() => {
      cy.findByText(/Requested by/).should(
        'contain.text',
        `Ana Weber, ${OFFER.department}`,
      )
      cy.findByText(OFFER.vendor).should('be.visible')
      cy.findByText(OFFER.vatId).should('be.visible')
      cy.findByText(/Commodity Group/)
        .next()
        .should('contain.text', 'Information Technology')
        .and('contain.text', 'Software')
        .and('contain.text', '(ID 031)')

      OFFER.lines.forEach((line) => {
        cy.findByText(line.description)
          .closest('tr')
          .within(() => {
            cy.get('td').eq(2).should('have.text', `€${line.price}`)
            cy.get('td').eq(3).should('have.text', line.amount)
            if (unit != null) cy.get('td').eq(4).should('have.text', unit)
            else cy.get('td').eq(4).should('not.be.empty')
            cy.get('td').eq(5).should('have.text', line.sheetTotal)
          })
      })
      cy.findByText(/Total Cost/).should('contain.text', '€2,100.00')
    })

  // The creation entry is on the status trail already.
  cy.contains('Status Trail')
    .parent('section')
    .find('ol')
    .find('li')
    .should('have.length', 1)
    .and('contain.text', 'Created as')
    .and('contain.text', 'Open')
}

describe('J3 — Offer upload → auto-fill → submit', () => {
  let prefix

  beforeEach(() => {
    cy.resetAppData()
    cy.signIn() // requestor Ana Weber — J3 is the requestor's journey
    cy.runPrefix().then((p) => (prefix = p))
  })

  it('extracts the README vendor offer verbatim, auto-fills, and submits', () => {
    const title = `${prefix} — Photoshop & Illustrator Licenses`
    uploadOffer('cypress/fixtures/sample-offer.txt')

    // 2. The README offer's labeled layout resolves at L1 — deterministic,
    // zero LLM calls (docs/PROJECT_PLAN.md WS2 "done when").
    cy.findByText('Extracted deterministically (L1)').should('be.visible')
    assertDetectedSummary()
    assertPrefilledForm()

    // The only field left to the user: the request title (not on the offer).
    cy.findByLabelText(/Title \/ Short Description/).type(title)

    // 5. The extraction also produced a commodity group suggestion — never
    // chosen by the user — refined once the title is in ("High Confidence").
    assertCommoditySuggestion()

    // 6. Submit → 7. persisted with the extracted values verbatim.
    cy.findByRole('button', { name: 'Submit Request' }).click()
    assertSavedRequest(title, 'pieces')
  })

  it('extracts an unseen offer format via the LLM fuse (L2)', () => {
    // An offer in a layout L1's label parser cannot read → the LLM fuse does
    // the extraction and the same validators re-check every value.
    uploadOffer('cypress/fixtures/sample-offer-alternate-format.txt')
    cy.findByText('Extracted via LLM (L2)', { timeout: LLM_WAIT }).should('be.visible')
    cy.contains('language model produced this draft').should('be.visible')

    assertDetectedSummary()
    assertPrefilledForm()
    // The offer states no unit of measure — the honest extraction leaves it
    // blank, and the form fills its default.

    const title = `${prefix} — Licenses (unseen format via LLM)`
    cy.findByLabelText(/Title \/ Short Description/).type(title)
    assertCommoditySuggestion()

    cy.findByRole('button', { name: 'Submit Request' }).click()
    assertSavedRequest(title, 'pieces')
  })

  it('keeps missing totals blank and flagged, so the user completes the request', () => {
    // Partial document variant: the offer states no grand total — the LLM
    // must report the absence (missing ≠ missed), the field stays blank and
    // flagged, and manual entry completes a still-valid request.
    uploadOffer('cypress/fixtures/sample-offer-partial.txt')
    cy.findByText('Extracted via LLM (L2)', { timeout: LLM_WAIT }).should('be.visible')

    cy.contains('Vendor Name').should('be.visible') // the rest WAS extracted
    cy.findByLabelText('Vendor Name').should('have.value', OFFER.vendor)
    cy.contains('not detected — please enter manually').should('be.visible')
    cy.findByLabelText('Total Cost').should('have.value', '')

    // Manual completion: title + the missing grand total; line sums already
    // add up, so the form validates once the total is entered.
    const title = `${prefix} — Licenses (missing total completed manually)`
    cy.findByLabelText(/Title \/ Short Description/).type(title)
    cy.findByLabelText('Total Cost').type('2100.00')
    cy.findByRole('button', { name: 'Submit Request' }).click()
    // The document stated no units — the LLM reports their absence, the form
    // fills its default, and the request validates either way.
    assertSavedRequest(title, null)
  })

  it('degrades to manual entry with a clear message when the AI is unavailable', () => {
    // AI-unavailable variant: the LLM tier is off (the mock's stand-in for
    // the documented LLM_TIER=off deployment) — the UI says so and the user
    // can still complete the request without it.
    cy.disableAi()
    const title = `${prefix} — Licenses (manual entry)`
    uploadOffer('cypress/fixtures/sample-offer-alternate-format.txt')
    cy.findByRole('alert').should('contain.text', 'enter the details manually')
    cy.contains('AI extraction is switched off').should('be.visible')

    // Manual entry — exactly the J1 intake, but on top of the refused upload.
    cy.findByLabelText(/Title \/ Short Description/).type(title)
    cy.findByLabelText('Vendor Name').type(OFFER.vendor)
    cy.findByLabelText(/VAT ID/).type(OFFER.vatId)
    cy.findByLabelText('Department').type(OFFER.department)
    OFFER.lines.forEach((line, i) => {
      const n = i + 1
      if (i > 0) cy.findByRole('button', { name: '+ Add Order Line' }).click()
      cy.findByLabelText(`Line ${n} Description`).type(line.description)
      cy.findByLabelText(`Line ${n} Unit Price`).type(line.price)
      cy.findByLabelText(`Line ${n} Amount`).type(line.amount)
      cy.findByLabelText(`Line ${n} Unit`).type('pieces')
      cy.findByLabelText(`Line ${n} Line Total`).should('have.value', line.total)
    })
    cy.findByLabelText('Total Cost').should('have.value', OFFER.total)
    assertCommoditySuggestion()

    cy.findByRole('button', { name: 'Submit Request' }).click()
    assertSavedRequest(title, 'pieces')
  })
})