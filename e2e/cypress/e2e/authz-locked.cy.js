/*
 * Locked records — anything already In Progress is uneditable, by anyone
 * (docs/ARCHITECTURE.md: authorization is enforced at the API boundary; the
 * boundary rule itself is "only Open requests are mutable" — PUT
 * /requests/:id answers 409 for every role otherwise, requestor, procurement
 * and admin alike).
 *
 * The seeded demo state carries r1, "Adobe Creative Cloud Subscription",
 * already In Progress, so every role is asserted directly without a setup
 * journey. What each sees is the same read-only record: the extraction pane
 * offers no editable form, and the center pane's only live affordances are
 * the status ones (procurement/admin), never field edits.
 */

describe('Locked records — an In Progress request is not editable by anyone', () => {
  const lockedProse = /its record is locked/

  beforeEach(() => {
    cy.resetAppData() // back to the seeded demo state — r1 is In Progress there
  })

  it('the requestor’s own In Progress request shows no edit form', () => {
    cy.signIn() // ana — the owner of r1
    cy.seededId('r1').then((id) => cy.visit(`/?selected=${id}`))

    cy.findByText(lockedProse).should('be.visible')
    // No editable field anywhere in the extraction pane — the locked record
    // renders its provenance strip and prose only.
    cy.get('.extraction').find('input, textarea, select').should('not.exist')
    // No edit affordances in the whole workbench for anyone.
    cy.findByRole('button', { name: 'Save Changes' }).should('not.exist')
    cy.findByRole('button', { name: 'Submit Request' }).should('not.exist')
    cy.findByRole('button', { name: 'Discard Changes' }).should('not.exist')
  })

  it('procurement reads the same locked record — only the status trail moves', () => {
    cy.signIn('kim@example.com')
    cy.seededId('r1').then((id) => cy.visit(`/?selected=${id}`))

    cy.findByText(lockedProse).should('be.visible')
    cy.get('.extraction').find('input, textarea, select').should('not.exist')
    cy.findByRole('button', { name: 'Save Changes' }).should('not.exist')

    // The one live affordance is the documented status mover — status, not
    // facts. In Progress advances only to Closed.
    cy.findByRole('button', { name: 'Close Request' }).should('be.visible')
    cy.findByRole('button', { name: 'Move to “In Progress”' }).should('not.exist')
  })

  it('admin has no editing rights either — the lock is absolute', () => {
    cy.signIn('admin@example.com')
    cy.seededId('r1').then((id) => cy.visit(`/?selected=${id}`))

    cy.findByText(lockedProse).should('be.visible')
    cy.get('.extraction').find('input, textarea, select').should('not.exist')
    cy.findByRole('button', { name: 'Save Changes' }).should('not.exist')
    // Admin manages status like procurement but still cannot edit the record.
    cy.findByRole('button', { name: 'Close Request' }).should('be.visible')

    // The lock is not just cosmetic — it survives a reload (the boundary
    // would reject any edit with 409 regardless).
    cy.reload()
    cy.findByText(lockedProse).should('be.visible')
  })
})