/*
 * Authorization — requestors reach only their own documents (docs/
 * ARCHITECTURE.md: "authorization enforced server-side at the API boundary").
 *
 * Ana uploads an offer and files the request; Tom, the other requestor,
 * sees neither the request in his overview nor its uploaded document.
 * The boundary is the mock's (server.js): a foreign request answers 404,
 * so the workbench shows its "Request Not Available" state instead of the
 * request sheet — and a request can only carry a document its submitter
 * may access.
 */

describe('Document authorization — a requestor sees only their own uploads', () => {
  let prefix

  beforeEach(() => {
    cy.resetAppData()
    cy.runPrefix().then((p) => (prefix = p))
  })

  it('hides ana’s uploaded request and its document from tom', () => {
    // Ana: add request → upload the offer document → title → submit.
    cy.signIn() // requestor Ana Weber
    const title = `${prefix} — Ana's confidential offer`
    cy.openNewRequest()
    cy.url().should('include', 'selected=new')
    cy.findByRole('heading', { name: 'Have a Vendor Offer?' }).should('be.visible')
    // The input is visually hidden under the "Upload Offer" pill (native
    // file dialogs can't be driven by Cypress); the aria-labelled input is
    // the accessible upload affordance, so the file is attached directly —
    // the working pattern from J3.
    cy.findByLabelText('Upload offer document')
      .selectFile('cypress/fixtures/sample-offer.txt', { force: true })
    cy.findByText('Extracted deterministically (L1)').should('be.visible')
    cy.findByLabelText(/Title \/ Short Description/).type(title)

    // The extraction fills the rest — the request is ready to submit.
    cy.findByRole('button', { name: 'Submit Request' }).click()
    cy.url().should('match', /selected=r\d+/).then((url) => {
      const id = new URLSearchParams(url[0].split('?')[1]).get('selected')
      cy.wrap(id).as('anaRequestId')
    })

    // Ana's own view: the saved request sheet renders (she may read her upload).
    cy.findByRole('heading', { name: title }).should('be.visible')

    // Sign out (NavBar affordance), then Tom — the OTHER requestor.
    cy.findByRole('button', { name: 'Sign Out' }).click()
    cy.signIn('tom@example.com')
    const titleRe = new RegExp(title.replace(/[.*+?${}()|[\]\\]/g, '\\$&'))

    // His overview does not list ana's request (the rows are buttons).
    cy.findByRole('button', { name: titleRe }).should('not.exist')

    // Direct link to the request: the boundary answers 404, so the center
    // pane shows the not-available state — no request sheet, no document tab.
    cy.get('@anaRequestId').then((id) => {
      cy.visit(`/?selected=${id}`)
      cy.findByText('Request Not Available').should('be.visible')
      cy.findByText('Request not found.').should('be.visible')
      // The workbench itself is fine — the rail is just missing her request.
      cy.findByLabelText('Search requests').should('be.visible')
      cy.findByRole('button', { name: '+ Add Request' }).should('be.visible')
    })
  })
})