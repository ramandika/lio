/*
 * J4 — Commodity group: suggestion, not selection (docs/E2E_TESTING.md).
 *
 * The procurement manager's complaint the journey pins: "users always pick
 * the wrong one" — so the flow never asks. Over the Adobe-license scenario
 * the group is suggested on its own once enough context exists (zero
 * commodity touches by the user), an explicit override is honored and its
 * reason names the overridden suggestion, and the stored group is the
 * override — the suggestion is never truth (the LLM is only a suggestion;
 * the keyword-bank classifier needs no LLM tier here).
 */

describe('J4 — Commodity group: suggestion, not selection', () => {
  let prefix

  beforeEach(() => {
    cy.resetAppData()
    cy.signIn() // requestor Ana Weber
    cy.runPrefix().then((p) => (prefix = p))
  })

  it('suggests 031 on its own, honors an override, and stores the override', () => {
    // 1–2. New request, Adobe-license scenario; every non-AI field filled,
    // no commodity control is touched.
    const title = `${prefix} — Adobe Creative Cloud Renewal`
    cy.openNewRequest()
    cy.url().should('include', 'selected=new')
    cy.findByRole('heading', { name: 'Have a Vendor Offer?' }).should('be.visible')

    // Not yet enough context: nothing suggested, nothing to un-choose —
    // the card says a suggestion appears on its own. (It sits below the
    // pane's fold, as in J3.)
    cy.contains('h3', 'Commodity Group').scrollIntoView()
    cy.findByText(/Describe the title and order lines — a suggestion appears here automatically/)
      .should('be.visible')
    cy.findByLabelText('Commodity Group (override if needed)').should('have.value', '')

    cy.findByLabelText(/Title \/ Short Description/).type(title)
    cy.findByLabelText('Vendor Name').type('Adobe Systems GmbH')
    cy.findByLabelText(/VAT ID/).type('DE123456789')
    cy.findByLabelText('Department').type('Creative Marketing Department')
    ;[
      { description: 'Adobe Photoshop License', price: '150', amount: '10', unit: 'licenses' },
      { description: 'Adobe Illustrator License', price: '120', amount: '5', unit: 'licenses' },
    ].forEach((line, i) => {
      const n = i + 1
      if (i > 0) cy.findByRole('button', { name: '+ Add Order Line' }).click()
      cy.findByLabelText(`Line ${n} Description`).type(line.description)
      cy.findByLabelText(`Line ${n} Unit Price`).type(line.price)
      cy.findByLabelText(`Line ${n} Amount`).type(line.amount)
      cy.findByLabelText(`Line ${n} Unit`).type(line.unit)
    })

    // 3. Enough context → the suggestion appears once, on its own: the card
    // names the group and shows confidence, and the user was never asked —
    // the override select is simply following the suggestion now.
    cy.findByText(/High Confidence/).should('be.visible')
    cy.contains('Information Technology · Software').should('be.visible')
    cy.findByLabelText('Commodity Group (override if needed)').should('have.value', '031')

    // 4. Override path: choose a different group explicitly — the card
    // switches to the manual state and names what it overrode.
    cy.findByLabelText('Commodity Group (override if needed)').select('015') // Office Equipment
    cy.findByText('Manually Selected').should('be.visible')
    cy.contains(/Overridden — the suggestion was “Software”/).should('be.visible')

    // 5. Submit → the stored group is the override, not the suggestion.
    cy.findByRole('button', { name: 'Submit Request' }).click()
    cy.url().should('match', /selected=[0-9a-f-]+/)
    cy.findByRole('heading', { name: title }).should('be.visible')
    cy.findByText(/Requested by/)
      .closest('article')
      .within(() => {
        cy.findByText(/Commodity Group/)
          .next()
          .should('contain.text', 'Facility Management')
          .and('contain.text', 'Office Equipment')
          .and('contain.text', '(ID 015)')
        // The suggested group (031) must not surface anywhere in the sheet.
        cy.findByText(/Information Technology/).should('not.exist')
        cy.findByText(/Software/).should('not.exist')
      })
  })
})