/*
 * The close move — procurement's grant of a request (docs/ARCHITECTURE.md:
 * "procurement sees all and manages status"; valid moves Open → In Progress
 * → Closed only, append-only trail).
 *
 * Seeded state carries every leg without a setup journey: r1 is In
 * Progress (Kim's mover is the "Close Request" affordance), r2 is Open, and
 * r3 is already Closed.
 *
 * The rejected-move case is honest about reachability: the workbench renders
 * a mover only for a transition the boundary allows, and once Closed the
 * mover disappears — so no invalid transition is clickable in the UI. What
 * the boundary answers a stale screen (two tabs of Kim, a superseded sheet)
 * is asserted against the exported transition rule the mock enforces and the
 * sheet mirrors (frontend/src/api/mock/server.js, validateTransition).
 */

describe('Close Request — the move to Closed confirms as “Approved”', () => {
  beforeEach(() => {
    cy.resetAppData() // back to the shipped seed — r1 In Progress, r2 Open, r3 Closed
  })

  it('kim closes the In Progress request and reads back exactly “Approved”', () => {
    cy.signIn('kim@example.com')
    cy.visit('/?selected=r1')

    cy.findByRole('button', { name: 'Close Request' }).click()

    // The confirmation is the decision itself, one word — not a sentence.
    cy.findByText('Approved').should('be.visible')
    // The mover vanished with the request's last allowed transition; the
    // comment box went with it.
    cy.findByRole('button', { name: 'Close Request' }).should('not.exist')
    cy.findByLabelText(/^Comment \(kept in the history\)/).should('not.exist')
    // The append-only trail gained Kim's In Progress → Closed entry.
    cy.contains('Status Trail')
      .parent('section')
      .find('ol')
      .find('li')
      .should('have.length', 3)
      .last()
      .and('contain.text', 'In Progress → Closed')
      .and('contain.text', 'Kim Schneider')
    // The record itself reads Closed, in the head and the rail.
    cy.contains('.docview__head .pill', 'Closed').should('be.visible')
  })

  it('an Open move reads the same one-word shape — “In Progress”', () => {
    cy.signIn('kim@example.com')
    cy.visit('/?selected=r2')

    cy.findByRole('button', { name: 'Move to “In Progress”' }).click()

    // Same shape as the close confirmation: the status name itself ("In
    // Progress" also matches the head pill here, so the banner scopes it).
    cy.get('.banner--success').findByText('In Progress').should('be.visible')
    // The mover advanced to the chain's next (last) leg.
    cy.findByRole('button', { name: 'Close Request' }).should('be.visible')
  })

  it('a Closed request offers no move at all — and the boundary refusal is enriched', () => {
    cy.signIn('kim@example.com')
    cy.visit('/?selected=r3')

    // No mover is rendered for Closed — the UI simply has nothing to click,
    // and no stale comment box to send an invalid transition from.
    cy.findByRole('button', { name: 'Close Request' }).should('not.exist')
    cy.findByRole('button', { name: /^Move to / }).should('not.exist')
    cy.findByLabelText(/^Comment \(kept in the history\)/).should('not.exist')

    // Boundary-level (not UI-reachable): what POST /requests/:id/status
    // answers a stale session trying to close an already-Closed request —
    // the refusal names why: the chain has ended, nothing may follow it.
    cy.window()
      .then((win) => win.eval('import("/src/api/mock/server.js")'))
      .then((mock) => {
        cy.wrap(mock.validateTransition('Closed', 'Closed'))
          .should('contain', 'A request in “Closed” cannot move to “Closed”')
          .and('contain', 'Open → In Progress → Closed')
        // Off-chain skips are refused with the reachable status named.
        cy.wrap(mock.validateTransition('Open', 'Closed'))
          .should('contain', 'cannot move to “Closed”')
          .and('contain', 'it may only move to “In Progress”')
        // The chain's real moves stay clean of a refusal.
        cy.wrap(mock.validateTransition('In Progress', 'Closed')).should('be.null')
      })
  })
})