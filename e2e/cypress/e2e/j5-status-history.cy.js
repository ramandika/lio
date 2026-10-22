/*
 * J5 — overview: status management and history (docs/E2E_TESTING.md §J5,
 * README step "Request Overview": "Implement a system to retain every
 * status update accurately").
 *
 * The journey in one continuous run: procurement finds the Open request the
 * way a user does — the rail's status filter and search box, the two
 * features no other spec drives — then walks Open → In Progress → Closed,
 * reading the append-only trail grow one entry at a time, each entry
 * stamped with old status, new status and a timestamp. A reload proves the
 * trail is persisted, not session state; a Closed request offers no mover
 * at all (the UI has nothing to click — the boundary refusals behind that
 * design are covered in status-close.cy.js).
 */

describe('J5 — status management and history', () => {
  // Seeded state (app/seed.py): r2 "Standing Desks for Design Team" is Open
  // (its trail is the single creation entry, by Ana Weber); r1 sits In
  // Progress and r3 Closed, so the filter has siblings to drop.
  const R2_TITLE = 'Standing Desks for Design Team'
  const R2_OPEN_SEARCH = 'Standing'
  const NOT_OPEN = 'Adobe Creative Cloud'

  beforeEach(() => {
    cy.resetAppData()
  })

  // The trail renders one <li> per history row, its line reading
  // "Old → New · <timestamp> · <who>" (or "Created as <Open> · …").
  // Timestamps are locale-formatted (formatDateTime), so presence is
  // asserted with a locale-tolerant clock-time pattern rather than a
  // literal date.
  const trail = () => cy.contains('Status Trail').parent('section').find('ol li')

  it('kim finds the Open request via filter + search and walks it to Closed', () => {
    cy.signIn('kim@example.com')

    /* 2 — find it: filter by status, search by title, both exercised. */

    // Status filter: only the Open leg qualifies — the In Progress (r1)
    // and Closed (r3) siblings drop out.
    cy.findByRole('button', { name: 'Open' }).click()
    cy.contains('.rail__list li', R2_TITLE).should('be.visible')

    // Search inside the filtered overview: a no-match title empties the
    // rail; the request's own title narrows it to exactly one row.
    cy.findByLabelText('Search requests').type('Cyber')
    cy.findByText('Nothing matches this filter.').should('be.visible')

    cy.findByLabelText('Search requests').clear()
    cy.findByLabelText('Search requests').type(R2_OPEN_SEARCH)
    cy.get('.rail__list li').should('have.length', 1)
    cy.contains('.rail__list li', R2_TITLE)
      .should('be.visible')
      .should('contain.text', 'Open')
      .click()

    /* 3 — change status: Open → In Progress. */

    // The pre-move trail is the creation entry alone.
    trail().should('have.length', 1)
    trail().last().should('contain.text', 'Created as')
      .and('contain.text', 'Ana Weber')

    cy.findByRole('button', { name: 'Move to “In Progress”' }).click()

    // "In Progress" also matches the head pill, so the banner scopes it.
    cy.get('.banner--success').findByText('In Progress').should('be.visible')
    // Badge updates in the rail row and the head; the trail grows by one
    // entry naming old status, new status, timestamp and the mover.
    cy.contains('.docview__head .pill', 'In Progress').should('be.visible')
    trail().should('have.length', 2)
    trail().last()
      .and('contain.text', 'Open → In Progress')
      .and('contain.text', 'Kim Schneider')

    /* 4 — change status again: In Progress → Closed. */

    cy.findByRole('button', { name: 'Close Request' }).click()

    // Same one-word decision shape the close journey confirms by.
    cy.findByText('Approved').should('be.visible')

    // History now has three entries, in chronological order: creation,
    // first transition, second transition — every one timestamped.
    trail().should('have.length', 3)
    trail().find('p.history__line').then(($lines) => {
      const lines = [...$lines].map((p) => p.textContent)
      expect(lines[0]).to.contain('Created as')
      expect(lines[0]).not.to.contain('→')
      expect(lines[1]).to.contain('Open → In Progress')
      expect(lines[2]).to.contain('In Progress → Closed')
      lines.forEach((line) => expect(line).to.match(/\d{1,2}[:.]\d{2}/))
    })

    /* 5 — reload: the trail is persisted, not session state. */

    cy.reload()
    trail().should('have.length', 3)
    trail().find('p.history__line').then(($lines) => {
      const lines = [...$lines].map((p) => p.textContent)
      expect(lines[0]).to.contain('Created as')
      expect(lines[1]).to.contain('Open → In Progress')
      expect(lines[2]).to.contain('In Progress → Closed')
    })
    cy.contains('.docview__head .pill', 'Closed').should('be.visible')

    /* 6 — re-open guard: a Closed request offers no move at all. */

    // No mover and no stale comment box — an invalid transition has
    // nothing to be clicked from (boundary refusals for stale screens:
    // status-close.cy.js).
    cy.findByRole('button', { name: 'Close Request' }).should('not.exist')
    cy.findByRole('button', { name: /^Move to / }).should('not.exist')
    cy.findByLabelText(/^Comment \(kept in the history\)/).should('not.exist')

    // And the record now groups under the Closed filter.
    cy.findByRole('button', { name: 'Closed' }).click()
    cy.findByLabelText('Search requests').clear()
    cy.findByLabelText('Search requests').type(R2_OPEN_SEARCH)
    cy.get('.rail__list li').should('have.length', 1)
    cy.contains('.rail__list li', R2_TITLE).should('contain.text', 'Closed')
  })
})