/*
 * J2 — Intake: invalid submission is rejected (docs/E2E_TESTING.md).
 *
 * The README's rule **only valid requests can be submitted**, exercised as a
 * user hits it: one rule broken at a time with inline errors and nothing
 * persisted, then a fully fixed form submits — exactly once, no duplicates
 * from the failed attempts.
 */

describe('J2 — Intake: invalid submission is rejected', () => {
  let prefix

  beforeEach(() => {
    // Deterministic seed data: a known empty state per test, and a run-unique
    // title prefix so repeated/parallel runs cannot collide.
    cy.resetAppData()
    cy.signIn() // requestor Ana Weber — J2 is the requestor's journey
    cy.runPrefix().then((p) => (prefix = p))
  })

  it('rejects each broken variant inline, persists nothing, and saves the fixed request once', () => {
    const title = `${prefix} — Standing Desks Redo`
    const VALID = {
      requestor: 'Ana Weber',
      title,
      vendor: 'Steelcase GmbH',
      vatId: 'DE123456789',
      department: 'HR',
      lines: [
        { label: 'Line 1', description: 'Standing Desk', price: '400', amount: '3', unit: 'pieces' },
        { label: 'Line 2', description: 'Assembly Service', price: '300', amount: '1', unit: 'hours' },
      ],
    }

    /**
     * Submit failed as expected: the inline error is shown beside the
     * offending field, the draft stays open, and nothing persisted — the
     * overview gained no entry for this request.
     */
    const expectRejected = (message, label) => {
      cy.findByLabelText(label)
        .scrollIntoView() // the tall side pane keeps the lower sections out of view
        .closest('.field') // the labelled field wrapper whose alert is the inline error
        .findByRole('alert')
        .should('be.visible')
        .and('contain.text', message)
      cy.url().should('include', 'selected=new') // the form is still open
      // The overview must not gain the request (nothing persisted).
      cy.findByRole('button', { name: new RegExp(title) }).should('not.exist')
    }

    const submit = () => cy.findByRole('button', { name: 'Submit Request' }).click()

    // 1. Start a new request with meaningful, otherwise-valid data.
    cy.openNewRequest()
    cy.findByLabelText('Requestor Name').should('have.value', VALID.requestor)
    cy.findByLabelText(/Title \/ Short Description/).type(VALID.title)
    cy.findByLabelText('Vendor Name').type(VALID.vendor)
    cy.findByLabelText(/VAT ID/).type(VALID.vatId)
    cy.findByLabelText('Department').type(VALID.department)
    VALID.lines.forEach((line, i) => {
      if (i > 0) cy.findByRole('button', { name: '+ Add Order Line' }).click()
      cy.findByLabelText(`${line.label} Description`).type(line.description)
      cy.findByLabelText(`${line.label} Unit Price`).type(line.price)
      cy.findByLabelText(`${line.label} Amount`).type(line.amount)
      cy.findByLabelText(`${line.label} Unit`).type(line.unit)
    })
    cy.findByText(/Line totals:/).find('strong').should('have.text', '1500.00 €')
    cy.findByLabelText('Total Cost').should('have.value', '1500.00')

    // 2a. Missing requestor name → inline error.
    cy.findByLabelText('Requestor Name').clear()
    submit()
    expectRejected('Requestor name is required.', 'Requestor Name')
    // One rule at a time — restore it before breaking the next.
    cy.findByLabelText('Requestor Name').type(VALID.requestor)

    // 2b. Malformed VAT IDs (the doc's two examples) → inline error.
    cy.findByLabelText(/VAT ID/).clear().type('123')
    submit()
    expectRejected('VAT ID must match the DE123456789 format.', /VAT ID/)
    cy.findByLabelText(/VAT ID/).clear().type('XX123456789')
    submit()
    expectRejected('VAT ID must match the DE123456789 format.', /VAT ID/)

    // 2c. Order line with amount 0 → inline error.
    cy.findByLabelText(/VAT ID/).clear().type(VALID.vatId)
    cy.findByLabelText('Line 1 Amount').clear().type('0')
    submit()
    expectRejected('Amount must be a whole number greater than 0.', 'Line 1 Amount')
    // 2d. Edited unit price that no longer matches the line total → inline
    // error. The total only follows the line while it was never touched, so
    // break the bond the way a user does: fix an auto total by hand, then
    // change the price — the total is now stale.
    cy.findByLabelText('Line 1 Amount').clear().type(VALID.lines[0].amount)
    cy.findByLabelText('Line 1 Line Total').clear().type('1600')
    cy.findByLabelText('Line 1 Unit Price').clear().type('100')
    submit()
    expectRejected('Line total must equal unit price × amount.', 'Line 1 Line Total')
    // Leave 2d broken — 3. every earlier rejected variant persisted nothing,
    // and this one stays broken until the fix below.

    // 4. Fix all fields → submit succeeds → the request exists exactly once
    // (no duplicates from the earlier failed attempts).
    cy.findByRole('button', { name: 'Submit Request' }).should('not.be.disabled') // the draft is intact
    cy.findByLabelText('Line 1 Unit Price').clear().type(VALID.lines[0].price)
    cy.findByLabelText('Line 1 Line Total').clear().type('1200') // back to 400 × 3
    cy.findByText(/Line totals:/).find('strong').should('have.text', '1500.00 €')
    cy.findByLabelText('Total Cost').should('have.value', '1500.00') // still correct after the manual line edits

    submit()

    cy.url().should('match', /selected=r\d+/)
    cy.findAllByRole('button', {
      name: new RegExp(`${title}[\\s\\S]*${VALID.vendor}[\\s\\S]*€1,500\\.00`),
    })
      .should('have.length', 1) // exactly once — no duplicates from the failed attempts
      .and('contain.text', 'Open')
  })
})