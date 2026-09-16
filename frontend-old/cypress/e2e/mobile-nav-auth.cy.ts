describe('Mobile nav with logged-in user', () => {
    beforeEach(() => {
        cy.viewport(390, 844)
        cy.intercept('GET', '/api/me', {
            statusCode: 200,
            body: {
                data: {
                    publicId: 'u-test',
                    username: 'nora',
                    email: 'nora@example.com',
                },
            },
        })
        cy.intercept('GET', '/api/markers/viewport*', {
            statusCode: 200,
            body: [],
        })
    })

    it('shows personal center and logout in side menu', () => {
        cy.intercept('POST', '/api/logout', { statusCode: 200, body: {} }).as('logout')

        cy.visit('/maps')
        cy.get('button[aria-label="打开个人导航菜单"]').click()

        cy.contains('个人中心').should('be.visible')
        cy.contains('退出登录').should('be.visible')

        cy.contains('退出登录').click()
        cy.wait('@logout')
        cy.url().should('include', '/maps')
    })
})
