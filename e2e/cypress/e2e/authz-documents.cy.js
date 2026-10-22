/*
 * Authorization — requestors reach only their own documents (docs/
 * ARCHITECTURE.md: "authorization enforced server-side at the API boundary").
 *
 * Tom, procurement, uploads an offer and files the request; Ana, the
 * requestor, sees neither his request in her overview nor its uploaded
 * document. The boundary is the mock's (server.js): a foreign request
 * answers 404, so the workbench shows its "Request Not Available" state
 * instead of the request sheet — and a request can only carry a document
 * its submitter may access.
 */

describe('Document authorization — a requestor sees only their own uploads', () => {
  let prefix

  beforeEach(() => {
    cy.resetAppData()
    cy.runPrefix().then((p) => (prefix = p))
  })

  it('hides tom’s uploaded request and its document from ana', () => {
    // Tom: add request → upload the offer document → title → submit.
    cy.signIn('tom@example.com')
    const title = `${prefix} — Tom's confidential offer`
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
    // The backend assigns UUID ids to created requests.
    cy.url().should('match', /selected=[0-9a-f-]+/).then((url) => {
      const id = new URLSearchParams(url[0].split('?')[1]).get('selected')
      cy.wrap(id).as('tomRequestId')
    })

    // Tom's own view: the saved request renders (he may read his upload).
    // A request created from an upload lands on the "Offer Document" tab —
    // the sheet with its heading is one tab away (the same render race the
    // J3 helper rides: the URL changes a beat before the render settles).
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

    // Sign out (NavBar affordance), then Ana — the REQUESTOR outsider:
    // tom is procurement, so the role boundary is the one to watch.
    cy.findByRole('button', { name: 'Sign Out' }).click()
    cy.signIn()
    const titleRe = new RegExp(title.replace(/[.*+?${}()|[\]\\]/g, '\\$&'))

    // Her overview does not list tom's request (the rows are buttons).
    cy.findByRole('button', { name: titleRe }).should('not.exist')

    // Direct link to the request: the boundary answers 404, so the center
    // pane shows the not-available state — no request sheet, no document tab.
    cy.get('@tomRequestId').then((id) => {
      cy.visit(`/?selected=${id}`)
      cy.findByText('Request Not Available').should('be.visible')
      cy.findByText('Request not found.').should('be.visible')
      // The workbench itself is fine — the rail is just missing his request.
      cy.findByLabelText('Search requests').should('be.visible')
      cy.findByRole('button', { name: '+ Add Request' }).should('be.visible')
    })
  })
})