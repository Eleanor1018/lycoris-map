describe('Search to map focus flow', () => {
    beforeEach(() => {
        cy.intercept('GET', '/api/me', {
            statusCode: 200,
            body: { data: null },
        })
    })

    it('navigates from search result to map and opens full marker details', () => {
        const marker = {
            id: 101,
            lat: 41.881832,
            lng: -87.623177,
            category: 'accessible_toilet',
            title: 'Search Marker 101',
            description: 'Popup detail from viewport marker data',
            isPublic: true,
            isActive: true,
            markImage: null,
            username: 'tester',
            userPublicId: 'u-test',
        }

        cy.intercept('GET', '/api/markers/search*', {
            statusCode: 200,
            body: [marker],
        }).as('searchMarkers')

        cy.intercept('GET', '/api/markers/viewport*', {
            statusCode: 200,
            body: [marker],
        }).as('viewportMarkers')
        cy.intercept({ method: 'GET', pathname: '/api/markers/101' }, { statusCode: 200, body: marker }).as('markerDetails')

        cy.visit('/search?q=Search%20Marker')
        cy.wait('@searchMarkers')
        cy.contains('Search Marker 101').should('exist').click()

        cy.url().should('include', '/maps')
        cy.url().should('include', 'markerId=101')
        cy.wait('@viewportMarkers')

        cy.get('.leaflet-popup-content').should('be.visible')
        cy.get('.leaflet-popup-content').within(() => {
            cy.contains('Search Marker 101').should('be.visible')
            cy.contains('无障碍卫生间').should('be.visible')
            cy.contains('Popup detail from viewport marker data').should('be.visible')
        })
    })
})
