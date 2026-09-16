describe('Documents', () => {
    beforeEach(() => {
        cy.intercept('GET', '/api/me', {
            statusCode: 200,
            body: { data: null },
        })
    })

    it('renders HRT guide with title and image', () => {
        cy.visit('/documents/nora-hrt-guide')
        cy.contains('雪雁的HRT指南').should('be.visible')
        cy.get('img[alt="Structure of Estradiol"]').should('be.visible')
    })

    it('shows floating toc button on mobile', () => {
        cy.viewport(390, 844)
        cy.visit('/documents/nora-hrt-guide')
        cy.get('button[aria-label="打开文档目录"]').should('be.visible')
    })
})
