const authStorageKey = 'lycoris.auth.user.v1'
const initialUser = { publicId: 'session-user-a', username: 'account-a', email: 'a@example.com' }
const nextUser = { publicId: 'session-user-b', username: 'account-b', email: 'b@example.com' }
const marker = {
    id: 301, lat: 39.9042, lng: 116.4074, title: 'Session test point',
    category: 'accessible_toilet', isPublic: true, isActive: true, reviewStatus: 'APPROVED',
    username: initialUser.username, userPublicId: initialUser.publicId,
}

const seedUser = (win: Window) => {
    win.localStorage.setItem(authStorageKey, JSON.stringify(initialUser))
    Object.defineProperty(win.navigator, 'geolocation', {
        configurable: true,
        value: { watchPosition: () => 1, clearWatch: () => undefined },
    })
}

const fillField = (label: string, value: string) => {
    cy.contains('label', new RegExp(`^${label}$`)).invoke('attr', 'for').then((id) => {
        cy.get(`input[id="${id}"]`).type(value)
    })
}

const expectLoggedOut = () => {
    cy.get('button[aria-label="打开登录导航菜单"]').should('be.visible')
    cy.window().should((win) => expect(win.localStorage.getItem(authStorageKey)).to.equal(null))
    cy.contains('登录已失效，请重新登录。').should('be.visible')
}

describe('Revoked session handling', () => {
    beforeEach(() => {
        cy.viewport(390, 844)
        cy.intercept('GET', '/api/me', { body: { data: initialUser } })
        cy.intercept('GET', '/api/markers/viewport*', { body: [] })
        cy.intercept({ method: 'GET', pathname: '/api/markers/me/created' }, { body: [] })
        cy.intercept('GET', '/api/markers/me/favorites', { body: [] })
        cy.intercept({ method: 'GET', pathname: '/api/markers/301' }, { body: marker })
    })

    it('clears auth and offers login when a favorite request returns 401', () => {
        cy.intercept('POST', '/api/markers/301/favorite', { statusCode: 401, body: '请先登录' }).as('favorite')
        cy.visit('/maps?markerId=301', { onBeforeLoad: seedUser })
        cy.get('button[aria-label="收藏点位"]').click({ scrollBehavior: false })
        cy.wait('@favorite')
        expectLoggedOut()
        cy.contains('a', '重新登录').click()
        cy.url().should('include', '/login')
    })

    it('clears auth and closes the editor when saving returns 401', () => {
        cy.intercept({ method: 'PATCH', pathname: '/api/markers/301' }, { statusCode: 401, body: '请先登录' }).as('save')
        cy.visit('/maps?markerId=301', { onBeforeLoad: seedUser })
        cy.get('button[aria-label="编辑点位"]').click({ scrollBehavior: false })
        cy.get('[role="dialog"]').contains('button', '保存').click()
        cy.wait('@save')
        expectLoggedOut()
        cy.get('.MuiDialog-root').should('not.exist')
    })

    it('retains login when a protected request returns 403', () => {
        cy.intercept('POST', '/api/markers/301/favorite', { statusCode: 403, body: '权限不足' }).as('favorite')
        cy.visit('/maps?markerId=301', { onBeforeLoad: seedUser })
        cy.get('button[aria-label="收藏点位"]').click({ scrollBehavior: false })
        cy.wait('@favorite')
        cy.contains('权限不足').should('be.visible')
        cy.get('button[aria-label="打开个人导航菜单"]').should('be.visible')
        cy.contains('登录已失效，请重新登录。').should('not.exist')
        cy.window().should((win) => expect(JSON.parse(win.localStorage.getItem(authStorageKey) || '{}').publicId).to.equal(initialUser.publicId))
    })

    it('retains cached login when me returns 403', () => {
        cy.intercept('GET', '/api/me', { statusCode: 403, body: {} }).as('me')
        cy.visit('/maps', { onBeforeLoad: seedUser })
        cy.wait('@me')
        cy.get('button[aria-label="打开个人导航菜单"]').should('be.visible')
        cy.contains('登录已失效，请重新登录。').should('not.exist')
    })

    it('clears cached login when me returns 401', () => {
        cy.intercept('GET', '/api/me', { statusCode: 401, body: {} }).as('me')
        cy.visit('/maps', { onBeforeLoad: seedUser })
        cy.wait('@me')
        expectLoggedOut()
    })

    ;['login', 'register'].forEach((page) => {
        it(`does not expire a session for incorrect ${page} credentials`, () => {
            cy.intercept('POST', `/api/${page}`, { statusCode: 401, body: { message: '凭据错误' } }).as('credentials')
            cy.visit(`/${page}`, { onBeforeLoad: seedUser })
            if (page === 'login') fillField('用户名或邮箱', 'wrong-account')
            else {
                fillField('用户名', 'wrong-account')
                fillField('邮箱', 'wrong@example.com')
                fillField('再次输入密码', 'test-password')
            }
            fillField('密码', 'test-password')
            cy.get('button[type="submit"]').click()
            cy.wait('@credentials')
            cy.contains('凭据错误').should('be.visible')
            cy.get('button[aria-label="打开个人导航菜单"]').should('be.visible')
            cy.contains('登录已失效，请重新登录。').should('not.exist')
        })
    })

    it('ignores late old-session 401 and me responses after a new login', { defaultCommandTimeout: 15000 }, () => {
        let signedUser: typeof initialUser | null = initialUser
        let holdNextMe = false
        let releaseMe: (() => void) | undefined
        let releaseFavorite: (() => void) | undefined
        cy.intercept('GET', '/api/me', (req) => {
            if (holdNextMe) {
                holdNextMe = false
                return new Promise<void>((resolve) => {
                    releaseMe = () => { req.reply({ body: { data: initialUser } }); resolve() }
                })
            }
            req.reply({ body: { data: signedUser } })
        })
        cy.intercept('POST', '/api/markers/301/favorite', (req) => new Promise<void>((resolve) => {
            releaseFavorite = () => { req.reply({ statusCode: 401, body: '旧会话已失效' }); resolve() }
        })).as('oldFavorite')
        cy.intercept('POST', '/api/logout', (req) => { signedUser = null; req.reply({ body: {} }) })
        cy.intercept('POST', '/api/login', (req) => {
            signedUser = nextUser
            req.reply({ body: { code: 0, data: nextUser } })
        }).as('login')
        cy.visit('/maps?markerId=301', { onBeforeLoad: seedUser })
        cy.get('button[aria-label="收藏点位"]').click({ scrollBehavior: false })
        cy.wrap(null).should(() => expect(releaseFavorite).to.be.a('function'))
        cy.window().then((win) => { holdNextMe = true; win.dispatchEvent(new win.Event('focus')) })
        cy.wrap(null).should(() => expect(releaseMe).to.be.a('function'))
        cy.get('button[aria-label="打开个人导航菜单"]').click()
        cy.contains('退出登录').click()
        cy.get('button[aria-label="打开登录导航菜单"]').click()
        cy.get('[role="presentation"]').contains('登录').click()
        fillField('用户名或邮箱', nextUser.username)
        fillField('密码', 'next-password')
        cy.get('button[type="submit"]').click()
        cy.wait('@login')
        cy.window().should((win) => expect(JSON.parse(win.localStorage.getItem(authStorageKey) || '{}').publicId).to.equal(nextUser.publicId))
        cy.then(() => { releaseFavorite?.(); releaseMe?.() })
        cy.wait('@oldFavorite')
        cy.get('button[aria-label="打开个人导航菜单"]').should('be.visible')
        cy.contains('登录已失效，请重新登录。').should('not.exist')
        cy.window().should((win) => expect(JSON.parse(win.localStorage.getItem(authStorageKey) || '{}').publicId).to.equal(nextUser.publicId))
    })
})
