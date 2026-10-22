/*
 * J6 — persistence across restarts (docs/E2E_TESTING.md §J6): the README's
 * deployment is local, so the E2E suite also proves the storage contract,
 * not just session state.
 *
 * The journey in one run: journey J1's file flow creates a request (a
 * run-unique title is the handle to find it by), the app container is
 * restarted — the db container keeps running, so anything afterwards can
 * only be answered from storage — and the overview shows the request still
 * there, its creation trail intact.
 */

describe('J6 — persistence across restarts', () => {
  let prefix

  beforeEach(() => {
    cy.resetAppData()
    cy.runPrefix().then((p) => (prefix = p))
  })

  it('keeps the filed request and its history through an app restart', () => {
    /* 1 — journey J1 creates a request; note its title. */

    cy.signIn() // requestor Ana Weber — filing is the requestor's move
    const title = `${prefix} — Adobe Creative Cloud Subscription`
    const vendor = 'Adobe Systems GmbH'
    const vatId = 'DE123456789'
    const department = 'Creative Marketing Department'

    cy.openNewRequest()
    cy.url().should('include', 'selected=new')
    cy.findByLabelText(/Title \/ Short Description/).type(title)
    cy.findByLabelText('Vendor Name').type(vendor)
    cy.findByLabelText(/VAT ID/).type(vatId)
    cy.findByLabelText('Department').type(department)
    cy.findByLabelText('Line 1 Description').type('Adobe Photoshop License')
    cy.findByLabelText('Line 1 Unit Price').type('150')
    cy.findByLabelText('Line 1 Amount').type('10')
    cy.findByLabelText('Line 1 Unit').type('licenses')
    cy.findByLabelText('Line 1 Line Total').should('have.value', '1500.00')
    cy.findByLabelText('Total Cost').should('have.value', '1500.00')

    cy.findByRole('button', { name: 'Submit Request' }).click()
    cy.url().should('match', /selected=[0-9a-f-]+/)

    // Note the state to compare against after the restart: the record with
    // its creation trail — one entry, by the requestor, timestamped.
    cy.findByRole('heading', { name: title }).should('be.visible')
    cy.contains('.docview__head .pill', 'Open').should('be.visible')
    cy.contains('Status Trail')
      .parent('section')
      .find('ol li')
      .should('have.length', 1)
      .and('contain.text', 'Created as')
      .and('contain.text', 'Open')
      .and('contain.text', 'Ana Weber')

    /* 2 — restart the application process. */

    // The app:restart task bounces the app container (db keeps running) and
    // resolves once /health answers again; the browser session — a cookie
    // over a server-side session in the db — is expected to survive it.
    cy.task('app:restart')

    /* 3 — overview: the request is still there, with history intact. */

    cy.reload()
    // The rail persists too: searching the run-unique prefix narrows the
    // list over the seeded siblings and still finds the filed row.
    cy.findByLabelText('Search requests').type(prefix)
    cy.get('.rail__list li').should('have.length', 1)
    cy.contains('.rail__list li', title)
      .should('be.visible')
      .should('contain.text', 'Open')
      .click()

    cy.findByRole('heading', { name: title }).should('be.visible')
    cy.contains('.docview__head .pill', 'Open').should('be.visible')
    cy.contains('Status Trail')
      .parent('section')
      .find('ol li')
      .should('have.length', 1)
      .and('contain.text', 'Created as')
      .and('contain.text', 'Open')
      .and('contain.text', 'Ana Weber')
  })
})