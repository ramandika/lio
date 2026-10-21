/*
 * J1 — Intake: create and submit a valid request (docs/E2E_TESTING.md).
 *
 * The full happy path of README challenge 1, step "Intake", exercised from
 * the outside: the README rule under test is **every request is saved** —
 * nothing valid is lost, and the overview shows exactly what was submitted.
 */

describe('J1 — Intake: create and submit a valid request', () => {
  let prefix

  beforeEach(() => {
    // Deterministic seed data: a known empty state per test, and a run-unique
    // title prefix so repeated/parallel runs cannot collide.
    cy.resetAppData()
    cy.signIn() // requestor Ana Weber — J1 is the requestor's journey
    cy.runPrefix().then((p) => (prefix = p))
  })

  it('files a complete request and finds it in the overview with a creation history entry', () => {
    const title = `${prefix} — Adobe Creative Cloud Subscription`
    const offer = {
      requestor: 'Ana Weber',
      department: 'Creative Marketing Department',
      vendor: 'Adobe Systems GmbH',
      vatId: 'DE123456789',
      lines: [
        { description: 'Adobe Photoshop License', price: '€150.00', amount: '10', unit: 'licenses', total: '€1,500.00' },
        { description: 'Adobe Illustrator License', price: '€120.00', amount: '5', unit: 'licenses', total: '€600.00' },
      ],
      // Amount fields are plain decimal strings; money is displayed as €1,500.00 style.
      prices: ['150', '120'],
      amounts: ['10', '5'],
      totals: ['1500.00', '600.00'],
      total: '€2,100.00',
    }

    // 1. Navigate to "New request" — the intake form opens in the extraction
    // layer pane, ready for the offer upload or manual entry.
    cy.openNewRequest()
    cy.url().should('include', 'selected=new')
    cy.findByRole('heading', { name: 'Have a Vendor Offer?' }).should('be.visible')
    cy.findByLabelText('Requestor Name').should('have.value', offer.requestor) // prefilled from the signed-in user

    // 2. Fill: requestor name, title, vendor name, vendor VAT ID, department
    cy.findByLabelText(/Title \/ Short Description/).type(title)
    cy.findByLabelText('Vendor Name').type(offer.vendor)
    cy.findByLabelText(/VAT ID/).type(offer.vatId)
    cy.findByLabelText('Department').type(offer.department)

    // 3. Add two order lines — line totals and total cost are computed/shown for the user
    offer.lines.forEach((line, i) => {
      const n = i + 1
      if (i > 0) cy.findByRole('button', { name: '+ Add Order Line' }).click()
      cy.findByLabelText(`Line ${n} Description`).type(line.description)
      cy.findByLabelText(`Line ${n} Unit Price`).type(offer.prices[i])
      cy.findByLabelText(`Line ${n} Amount`).type(offer.amounts[i])
      cy.findByLabelText(`Line ${n} Unit`).type(line.unit)
      cy.findByLabelText(`Line ${n} Line Total`).should('have.value', offer.totals[i])
    })

    // Both computed totals must be shown before submitting.
    cy.findByText(/Line totals:/).find('strong').should('have.text', '2100.00 €')
    cy.findByLabelText('Total Cost').should('have.value', '2100.00')

    // 6a. A commodity group was suggested — never chosen by the user: no
    // selection was made, the suggestion appeared on its own.
    cy.findByText('High Confidence').should('be.visible')
    // The headline renders "category · name" across spans — match by the
    // element's full text content.
    cy.contains('Information Technology · Software').should('be.visible')

    // 4. Submit
    cy.findByRole('button', { name: 'Submit Request' }).click()

    // 5. Confirmation: the saved request opens as a document, and it appears
    // in the overview with status "Open", correct title, vendor and total.
    cy.url().should('match', /selected=r\d+/)
    const overviewRow = cy.findByRole('button', {
      name: new RegExp(`${title}[\\s\\S]*${offer.vendor}[\\s\\S]*${offer.total}`),
    })
    overviewRow.should('contain.text', 'Open')

    // 6. The detail view shows every field, both order lines with unit
    // prices/amounts/totals, and a commodity group (the suggestion above —
    // the user never picked it). Assertions are scoped to the document sheet,
    // since names like the requestor also appear in the nav bar.
    cy.findByRole('heading', { name: title }).should('be.visible')
    cy.findByText(/Requested by/)
      .closest('article')
      .within(() => {
        cy.findByText(/Requested by/).should('contain.text', `${offer.requestor}, ${offer.department}`)
        cy.findByText(offer.vendor).should('be.visible')
        cy.findByText(offer.vatId).should('be.visible')
        cy.findByText(/Commodity Group/)
          .next()
          .should('contain.text', 'Information Technology')
          .and('contain.text', 'Software')
          .and('contain.text', '(ID 031)')

        offer.lines.forEach((line, i) => {
          // Document-sheet table row: Position · Description · Unit Price · Amount · Unit · Total
          cy.findByText(line.description)
            .closest('tr')
            .within(() => {
              cy.get('td').eq(2).should('have.text', line.price)
              cy.get('td').eq(3).should('have.text', line.amount)
              cy.get('td').eq(4).should('have.text', line.unit)
              cy.get('td').eq(5).should('have.text', line.total)
            })
        })
        cy.findByText(/Total Cost/).should('contain.text', offer.total)
      })

    // 7. Status history already contains the creation entry ("Open").
    cy.contains('Status Trail').should('be.visible')
    cy.contains('Status Trail')
      .parent('section')
      .find('ol')
      .find('li')
      .should('have.length', 1)
      .and('contain.text', 'Created as')
      .and('contain.text', 'Open')
  })
})