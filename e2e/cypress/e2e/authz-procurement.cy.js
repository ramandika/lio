/*
 * Authorization — procurement reaps its rights over everything the
 * requestors file (docs/ARCHITECTURE.md: "procurement sees all and manages
 * status"; "authorization enforced server-side at the API boundary").
 *
 * Ana uploads an offer and files the request; Kim, the procurement clerk,
 * sees that foreign request in her overview, reads its uploaded document on
 * the "Offer Document" tab (GET /documents/:id serves her every stored
 * document) — and moves the request Open → In Progress. The trail names her;
 * afterwards the record is locked for the requestor, whose edit form the
 * clerk's status change is the only mover of.
 */

describe('Procurement authorization — Kim sees every request and manages status', () => {
  let prefix

  beforeEach(() => {
    cy.resetAppData()
    cy.runPrefix().then((p) => (prefix = p))
  })

  it('reads ana’s uploaded document and moves her request to In Progress', () => {
    // Ana: add request → upload the offer document → title → submit
    // (the working J3 pattern).
    cy.signIn() // requestor Ana Weber
    const title = `${prefix} — Ana's marketing licenses`
    cy.openNewRequest()
    cy.url().should('include', 'selected=new')
    cy.findByRole('heading', { name: 'Have a Vendor Offer?' }).should('be.visible')
    cy.findByLabelText('Upload offer document')
      .selectFile('cypress/fixtures/sample-offer.txt', { force: true })
    cy.findByText('Extracted deterministically (L1)').should('be.visible')
    cy.findByLabelText(/Title \/ Short Description/).type(title)

    cy.findByRole('button', { name: 'Submit Request' }).click()
    cy.url().should('match', /selected=r\d+/)
    // Ana's own view of her upload — she may read it.
    cy.contains('.pdfview', 'sample-offer.txt').should('be.visible')
    cy.location('search').then((search) => {
      cy.wrap(new URLSearchParams(search).get('selected')).as('selectedId')
    })

    // Sign out, then Kim — the procurement clerk.
    cy.findByRole('button', { name: 'Sign Out' }).click()
    cy.signIn('kim@example.com')

    // Her overview lists every requestor's filings — ana's among them.
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    cy.findByRole('button', { name: new RegExp(`${esc(title)}`) })
      .should('be.visible')
      .should('contain.text', 'Open')
      .click()

    // The saved request renders with its uploaded document — for a fresh
    // request the view lands on the "Offer Document" tab directly. The
    // document (a stored-text upload, not a PDF) shows its filename — the
    // mock's GET /documents/:id serves every document to procurement.
    cy.findByRole('tab', { name: 'Offer Document' }).should('be.visible')
    cy.findByRole('tab', { name: 'Request Sheet' }).should('be.visible')
    cy.contains('.pdfview', 'sample-offer.txt').should('be.visible')
    cy.contains('Uploaded as stored text').should('be.visible')

    // The creation entry is the only trail row, made by the requestor.
    cy.contains('Status Trail')
      .parent('section')
      .find('ol')
      .find('li')
      .should('have.length', 1)
      .and('contain.text', 'Created as')
      .and('contain.text', 'Ana Weber')

    // Status management: exactly one mover affordance per valid transition,
    // Open → In Progress.
    cy.findByRole('button', { name: 'Move to “In Progress”' }).click()

    // The status pill updates in the rail (the trail gains an entry naming
    // Kim, with the Open → In Progress transition).
    cy.contains('Status Trail')
      .parent('section')
      .find('ol')
      .find('li')
      .should('have.length', 2)
      .and('contain.text', 'Open → In Progress')
      .and('contain.text', 'Kim Schneider')
    cy.findByRole('button', { name: new RegExp(`${esc(title)}[\\s\\S]*In Progress`) })
      .should('be.visible')

    // The record is now In Progress — the requestor's edit form is locked
    // (the clerk's status change is the only mover, and the record's facts
    // stopped being editable).
    cy.findByRole('button', { name: 'Sign Out' }).click()
    cy.signIn() // ana again
    cy.get('@selectedId').then((id) => cy.visit(`/?selected=${id}`))

    cy.findByText(/its record is locked/).should('be.visible')
    cy.findByRole('button', { name: 'Move to “In Progress”' }).should('not.exist')

    // Her uploaded document is still hers to read on the trail tab.
    cy.findByRole('tab', { name: 'Offer Document' }).should('be.visible')
    cy.contains('.pdfview', 'sample-offer.txt').should('be.visible')
  })
})