const disablePerformanceTestLocation = (win: Window) => {
    Object.defineProperty(win.navigator, 'geolocation', {
        configurable: true,
        value: { watchPosition: () => 1, clearWatch: () => undefined },
    })
}

describe('Map marker rendering reuse', () => {
    it('keeps unchanged SVGs and coordinates while still applying marker updates', () => {
        cy.viewport(1280, 900)
        const first = {
            id: 901, lat: 39.9042, lng: 116.4074, title: 'First point', description: 'Original details',
            category: 'accessible_toilet', isPublic: true, isActive: true, reviewStatus: 'APPROVED', username: 'tester',
        }
        const second = { ...first, id: 902, lng: 116.4374, title: 'Unchanged point', category: 'baby_room' }
        let points = [first, second]
        cy.intercept('GET', '/api/me', { body: { data: null } })
        cy.intercept('GET', '/api/markers/viewport*', (req) => req.reply(points)).as('viewport')
        cy.visit('/maps', { onBeforeLoad: disablePerformanceTestLocation })
        cy.wait('@viewport')

        let icons: HTMLElement[]
        let svgs: (SVGSVGElement | null)[]
        let firstPosition: string
        let styleWrites = 0
        let observer: MutationObserver
        cy.get('.leaflet-marker-icon').should('have.length', 2).then(($icons) => {
            icons = $icons.toArray()
            svgs = icons.map((icon) => icon.querySelector('svg'))
            firstPosition = icons[0].style.transform
            observer = new MutationObserver((changes) => { styleWrites += changes.length })
            icons.forEach((icon) => observer.observe(icon, { attributes: true, attributeFilter: ['style'] }))
        })
        cy.contains('button', '筛选点位').click()
        cy.contains('button', '筛选点位').click()
        cy.get('.leaflet-marker-icon').should(($icons) => {
            $icons.toArray().forEach((icon, index) => {
                expect(icon).to.equal(icons[index])
                expect(icon.querySelector('svg')).to.equal(svgs[index])
            })
            expect(styleWrites, 'unchanged markers do not rewrite their position').to.equal(0)
        }).then(() => observer.disconnect())

        cy.then(() => {
            points = [{ ...first, lat: first.lat + 0.001, category: 'friendly_clinic', isActive: false, title: 'Updated point' }, second]
        })
        cy.contains('button', '筛选点位').click()
        cy.contains('label', '自定义').click()
        cy.wait('@viewport')
        cy.get('.leaflet-marker-icon').should(($icons) => {
            expect($icons[0]).to.equal(icons[0])
            expect($icons[0].querySelector('svg')).not.to.equal(svgs[0])
            expect($icons[0].innerHTML).to.contain('#9e9e9e')
            expect($icons[0].style.transform).not.to.equal(firstPosition)
            expect($icons[1]).to.equal(icons[1])
            expect($icons[1].querySelector('svg')).to.equal(svgs[1])
        })
        cy.contains('button', '筛选点位').click()
        cy.get('.leaflet-marker-icon').first().click({ scrollBehavior: false })
        cy.get('.leaflet-popup-content').should('contain.text', 'Updated point').and('contain.text', 'Original details')
    })
})

describe('Preprocessed document search parity', () => {
    const about = '# Shared about\nAlpha **NeEdLe** omega.\n[Reference](https://example.test/hidden-only)\nLiteral [x] remains.'
    const guide = '# Shared guide\nBeta needle gamma.\n中文 **词语** marker.'
    const documentCards = () => cy.contains('文档结果').parent().next().find('.MuiCard-root')

    beforeEach(() => {
        cy.intercept('GET', '/api/me', { body: { data: null } })
        cy.intercept('GET', '/api/markers/search*', { body: [] })
        for (const [slug, content] of [['about', about], ['nora-hrt-guide', guide]]) {
            cy.intercept({ method: 'GET', pathname: `/src/docs/${slug}.md` }, {
                headers: { 'content-type': 'application/javascript' },
                body: `export default ${JSON.stringify(content)}`,
            })
        }
    })

    it('preserves document order, cleaned snippets, case and highlight styling', () => {
        cy.visit('/search?q=needle')
        documentCards().should('have.length', 2)
        documentCards().eq(0).find('.MuiCardContent-root > .MuiTypography-root').eq(0).should('have.text', 'Shared about')
        documentCards().eq(1).find('.MuiCardContent-root > .MuiTypography-root').eq(0).should('have.text', 'Shared guide')
        const expectedSnippets = [
            'Shared about Alpha NeEdLe omega. Reference Literal [x] …',
            'Shared guide Beta needle gamma. 中文 词语 marker.',
        ]
        const assertSnippets = () => {
            expectedSnippets.forEach((snippet, index) => {
                documentCards().eq(index).find('.MuiCardContent-root > .MuiTypography-root').eq(1).should('have.text', snippet)
            })
            documentCards().eq(0).contains('span', 'NeEdLe').should('have.css', 'background-color', 'rgba(208, 188, 255, 0.46)')
            documentCards().eq(1).contains('span', 'needle').should('have.css', 'background-color', 'rgba(208, 188, 255, 0.46)')
        }
        assertSnippets()
        cy.get('input[aria-label="搜索关键词"]').clear().type('  NeEdLe  ')
        documentCards().should('have.length', 2)
        assertSnippets()
    })

    it('keeps raw Markdown matches and literal punctuation matching', () => {
        cy.visit('/search?q=hidden-only')
        documentCards().should('have.length', 1).and('contain.text', 'Shared about').and('contain.text', '已命中关键词')
        cy.get('input[aria-label="搜索关键词"]').clear().type('[x]')
        documentCards().should('have.length', 1)
        documentCards().find('.MuiCardContent-root > .MuiTypography-root').eq(1).should('have.text', '…EdLe omega. Reference Literal [x] remains.')
        documentCards().contains('span', '[x]').should('have.css', 'background-color', 'rgba(208, 188, 255, 0.46)')
        cy.get('input[aria-label="搜索关键词"]').clear()
        cy.contains('输入关键词后会在这里显示文档结果').should('be.visible')
        documentCards().should('not.exist')
    })
})
