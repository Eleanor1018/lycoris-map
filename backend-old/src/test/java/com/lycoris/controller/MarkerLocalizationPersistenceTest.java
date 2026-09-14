package com.lycoris.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lycoris.LycorisApplication;
import com.lycoris.dto.MarkerCreateRequest;
import com.lycoris.dto.MarkerUpdateRequest;
import com.lycoris.entity.MapMarker;
import com.lycoris.entity.MapMarkerTranslation;
import com.lycoris.entity.MarkerEditProposal;
import com.lycoris.repository.MapMarkerRepository;
import com.lycoris.repository.MapMarkerTranslationRepository;
import com.lycoris.repository.MarkerEditProposalRepository;
import com.lycoris.repository.MarkerFavoriteRepository;
import com.lycoris.repository.MarkerImageProposalRepository;
import com.lycoris.service.ImageUploadService;
import com.lycoris.service.MapMarkerService;
import com.lycoris.service.MarkerLocalizationService;
import com.lycoris.service.MarkerSourceHash;
import com.lycoris.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.jdbc.EmbeddedDatabaseConnection;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import javax.sql.DataSource;
import java.sql.Connection;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@DataJpaTest(showSql = false, properties = {
        "spring.config.location=optional:classpath:/marker-localization-test-no-config.yml",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.sql.init.mode=never",
        "cache.marker.redis-enabled=false",
        "admin.second-factor-enabled=false",
        "app.upload-dir=target/marker-localization-unused-uploads"
})
@AutoConfigureTestDatabase(connection = EmbeddedDatabaseConnection.H2, replace = AutoConfigureTestDatabase.Replace.ANY)
@ContextConfiguration(classes = LycorisApplication.class)
@Import({MapMarkerService.class, MarkerLocalizationService.class, AdminMarkerController.class,
        MarkerLocalizationPersistenceTest.JsonConfiguration.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class MarkerLocalizationPersistenceTest {
    @Autowired MapMarkerRepository markers;
    @Autowired MapMarkerTranslationRepository translations;
    @Autowired MarkerEditProposalRepository proposals;
    @Autowired MapMarkerService service;
    @Autowired MarkerLocalizationService localization;
    @Autowired AdminMarkerController admin;
    @Autowired PlatformTransactionManager transactionManager;
    @Autowired DataSource dataSource;
    TransactionTemplate transaction;

    @BeforeEach void prepare() throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            assertThat(connection.getMetaData().getURL()).startsWith("jdbc:h2:mem:");
        }
        transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.executeWithoutResult(status -> {
            translations.deleteAllInBatch();
            proposals.deleteAllInBatch();
            markers.deleteAllInBatch();
        });
    }

    @Test void localizationReturnsCopiesAndNeverChangesOriginalTextOrVersion() {
        MapMarker source = markers.saveAndFlush(marker());
        translation(source, "en", "Accessible clinic", "English description");

        MapMarker english = localization.localize(source, "en");
        assertThat(english).isNotSameAs(source);
        assertThat(english.getTitle()).isEqualTo("Accessible clinic");
        assertThat(english.getContentLanguage()).isEqualTo("en");
        assertThat(english.getSourceLanguage()).isEqualTo("zh");
        assertThat(english.getId()).isEqualTo(source.getId());
        assertThat(source.getTitle()).isEqualTo("中文诊所");
        assertThat(markers.findById(source.getId()).orElseThrow().getVersion()).isEqualTo(source.getVersion());
        assertThat(localization.localize(source, "zh").getTitle()).isEqualTo("中文诊所");
    }

    @Test void sourceEditsInvalidateTranslationsAndSearchWithoutDeletingManualWork() {
        MapMarker source = markers.saveAndFlush(marker());
        service.saveLocalizedEdit(source, "en", "Unique translation match", "English description");
        assertThat(service.searchPublicActive("Unique translation match")).hasSize(1);
        MapMarker current = markers.findById(source.getId()).orElseThrow();
        service.saveLocalizedEdit(current, "zh", "新的中文原文", "更新描述");

        MapMarker updated = markers.findById(source.getId()).orElseThrow();
        MapMarker fallback = localization.localize(updated, "en");
        assertThat(fallback.getTitle()).isEqualTo("新的中文原文");
        assertThat(fallback.getContentLanguage()).isEqualTo("zh");
        assertThat(service.searchPublicActive("Unique translation match")).isEmpty();
        MapMarkerTranslation retained = translations.findByMarkerIdAndLanguage(source.getId(), "en").orElseThrow();
        assertThat(retained.getOrigin()).isEqualTo("MANUAL");
        assertThat(retained.getTitle()).isEqualTo("Unique translation match");
    }

    @Test void metadataChangesKeepTranslationsValidAndShareVisibility() {
        MapMarker source = markers.saveAndFlush(marker());
        translation(source, "en", "Metadata test", "description");
        String sourceHash = MarkerSourceHash.of(source);
        MarkerUpdateRequest request = new MarkerUpdateRequest();
        request.setLanguage("en");
        request.setCategory("baby_room");
        request.setIsPublic(false);
        assertThat(admin.adminUpdate(source.getId(), request, reviewer()).getStatusCode()).isEqualTo(HttpStatus.OK);

        MapMarker updated = markers.findById(source.getId()).orElseThrow();
        assertThat(updated.getSourceLanguage()).isEqualTo("zh");
        assertThat(MarkerSourceHash.of(updated)).isEqualTo(sourceHash);
        assertThat(localization.localize(updated, "en").getTitle()).isEqualTo("Metadata test");
        assertThat(service.searchPublicActive("Metadata test")).isEmpty();
    }

    @Test void approvingAnotherLanguagePreservesOriginalAndAdvancesTheSharedVersion() {
        MapMarker source = markers.saveAndFlush(marker());
        MarkerEditProposal proposal = proposals.saveAndFlush(proposal(source, "en", "Approved English title"));
        assertThat(admin.approveEditProposal(proposal.getId(), reviewer()).getStatusCode()).isEqualTo(HttpStatus.OK);

        MapMarker updated = markers.findById(source.getId()).orElseThrow();
        assertThat(updated.getTitle()).isEqualTo(source.getTitle());
        assertThat(updated.getDescription()).isEqualTo(source.getDescription());
        assertThat(updated.getSourceLanguage()).isEqualTo("zh");
        assertThat(updated.getVersion()).isEqualTo(source.getVersion() + 1);
        assertThat(updated.getCategory()).isEqualTo("baby_room");
        MapMarkerTranslation translated = translations.findByMarkerIdAndLanguage(source.getId(), "en").orElseThrow();
        assertThat(translated.getTitle()).isEqualTo("Approved English title");
        assertThat(translated.getOrigin()).isEqualTo("MANUAL");
        assertThat(translated.getSourceHash()).isEqualTo(MarkerSourceHash.of(updated));
        assertThat(proposals.findById(proposal.getId()).orElseThrow().getStatus()).isEqualTo("APPROVED");
    }

    @Test void secondProposalBasedOnTheSameVersionCannotReplaceTheFirstTranslation() {
        MapMarker source = markers.saveAndFlush(marker());
        MarkerEditProposal first = proposals.saveAndFlush(proposal(source, "en", "First translation"));
        MarkerEditProposal stale = proposals.saveAndFlush(proposal(source, "en", "Stale translation"));
        assertThat(admin.approveEditProposal(first.getId(), reviewer()).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(admin.approveEditProposal(stale.getId(), reviewer()).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(translations.findByMarkerIdAndLanguage(source.getId(), "en").orElseThrow().getTitle())
                .isEqualTo("First translation");
        assertThat(proposals.findById(stale.getId()).orElseThrow().getStatus()).isEqualTo("PENDING");
    }

    @Test void staleConcurrentTranslationEditCannotWriteAgainstNewSourceContent() {
        MapMarker source = markers.saveAndFlush(marker());
        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
            MapMarker stale = service.findById(source.getId()).orElseThrow();
            transaction.executeWithoutResult(winner -> {
                MapMarker current = service.findById(source.getId()).orElseThrow();
                service.saveLocalizedEdit(current, "zh", "更新后的中文", "更新后的描述");
            });
            service.saveLocalizedEdit(stale, "en", "Stale English", "Stale description");
        })).isInstanceOf(OptimisticLockingFailureException.class);
        assertThat(translations.findByMarkerIdAndLanguage(source.getId(), "en")).isEmpty();
        assertThat(markers.findById(source.getId()).orElseThrow().getTitle()).isEqualTo("更新后的中文");
    }

    @Test void losingTranslationApprovalRollsBackBothTranslationAndSharedMarkerChange() {
        MapMarker source = markers.saveAndFlush(marker());
        MarkerEditProposal proposal = proposals.saveAndFlush(proposal(source, "en", "Losing English translation"));
        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
            assertThat(proposals.findById(proposal.getId()).orElseThrow().getStatus()).isEqualTo("PENDING");
            transaction.executeWithoutResult(winner -> admin.rejectEditProposal(proposal.getId(), reviewer()));
            admin.approveEditProposal(proposal.getId(), reviewer());
            proposals.flush();
        })).isInstanceOf(OptimisticLockingFailureException.class);
        assertThat(translations.findByMarkerIdAndLanguage(source.getId(), "en")).isEmpty();
        assertThat(markers.findById(source.getId()).orElseThrow().getVersion()).isEqualTo(source.getVersion());
        assertThat(proposals.findById(proposal.getId()).orElseThrow().getStatus()).isEqualTo("REJECTED");
    }

    @Test void partialTranslationEditsUseValidTargetTextAndRejectMissingTargetBaselines() {
        MapMarker source = markers.saveAndFlush(marker());
        MarkerUpdateRequest patch = new MarkerUpdateRequest();
        patch.setLanguage("en");
        patch.setTitle("Changed English title");
        assertThatThrownBy(() -> service.resolveEditText(source, patch)).isInstanceOf(IllegalArgumentException.class);
        translation(source, "en", "Original English title", "Original English description");
        MapMarkerService.EditText resolved = service.resolveEditText(source, patch);
        assertThat(resolved.title()).isEqualTo("Changed English title");
        assertThat(resolved.description()).isEqualTo("Original English description");
        assertThat(resolved.language()).isEqualTo("en");
    }

    @Test void searchMatchesBothLanguagesAndExcludesInvalidPrivateAndUnapprovedTranslations() {
        MapMarker source = markers.saveAndFlush(marker());
        translation(source, "en", "Unique bilingual match", "English description");
        MapMarker privateMarker = marker();
        privateMarker.setIsPublic(false);
        privateMarker = markers.saveAndFlush(privateMarker);
        translation(privateMarker, "en", "Unique bilingual match", "Private description");
        MapMarker pending = marker();
        pending.setReviewStatus("PENDING");
        pending = markers.saveAndFlush(pending);
        translation(pending, "en", "Unique bilingual match", "Pending description");
        MapMarker stale = markers.saveAndFlush(marker());
        MapMarkerTranslation invalid = translation(stale, "en", "Unique bilingual match", "Stale description");
        invalid.setSourceHash("invalid");
        translations.saveAndFlush(invalid);
        translation(source, "zh", "Original-language fake match", "Not a translation");

        assertThat(service.searchPublicActive("Unique bilingual match")).extracting(MapMarker::getId)
                .containsExactly(source.getId());
        assertThat(service.searchPublicActive("中文诊所")).extracting(MapMarker::getId)
                .contains(source.getId()).doesNotContain(privateMarker.getId(), pending.getId());
        assertThat(service.searchPublicActive("Original-language fake match")).isEmpty();
    }

    @Test void englishCreationKeepsEnglishOriginalAndFallsBackForMissingChineseTranslation() {
        MarkerCreateRequest request = new MarkerCreateRequest();
        request.setLat(22.3);
        request.setLng(114.2);
        request.setCategory("friendly_clinic");
        request.setTitle("Original English clinic");
        request.setDescription("Original English description");
        request.setLanguage("en-US");
        MapMarker created = service.create("owner", "owner-public-id", request);
        assertThat(created.getSourceLanguage()).isEqualTo("en");
        MapMarker chinese = localization.localize(created, "zh");
        assertThat(chinese.getTitle()).isEqualTo("Original English clinic");
        assertThat(chinese.getContentLanguage()).isEqualTo("en");
        service.saveLocalizedEdit(created, "zh", "中文译文", "中文描述");
        assertThat(markers.findById(created.getId()).orElseThrow().getTitle()).isEqualTo("Original English clinic");
    }

    @Test void httpLanguageSelectionDoesNotLeakBetweenRequestsOrMutateOriginals() throws Exception {
        MapMarker source = markers.saveAndFlush(marker());
        translation(source, "en", "HTTP English clinic", "HTTP description");
        MarkerController controller = new MarkerController(service, mock(UserService.class),
                mock(MarkerFavoriteRepository.class), mock(MarkerImageProposalRepository.class),
                proposals, mock(ImageUploadService.class));
        MockMvc mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new MarkerLocalizationAdvice(localization)).build();

        mvc.perform(get("/api/markers/public").param("lang", "en").header("Accept-Language", "zh"))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].title").value("HTTP English clinic"))
                .andExpect(jsonPath("$[0].contentLanguage").value("en"))
                .andExpect(jsonPath("$[0].sourceLanguage").value("zh"));
        mvc.perform(get("/api/markers/public").param("lang", "zh").header("Accept-Language", "en"))
                .andExpect(jsonPath("$[0].title").value("中文诊所"));
        mvc.perform(get("/api/markers/public").header("Accept-Language", "en-US,en;q=0.9"))
                .andExpect(jsonPath("$[0].title").value("HTTP English clinic"));
        mvc.perform(get("/api/markers/public").param("lang", "invalid").header("Accept-Language", "en"))
                .andExpect(jsonPath("$[0].title").value("中文诊所"));
        assertThat(markers.findById(source.getId()).orElseThrow().getTitle()).isEqualTo("中文诊所");
    }

    @Test void deletingAMarkerAlsoDeletesItsTranslations() {
        MapMarker source = markers.saveAndFlush(marker());
        translation(source, "en", "Deleted translation", "description");
        service.delete(source);
        assertThat(markers.findById(source.getId())).isEmpty();
        assertThat(translations.findByMarkerIdAndLanguage(source.getId(), "en")).isEmpty();
    }

    private MapMarkerTranslation translation(MapMarker source, String language, String title, String description) {
        MapMarkerTranslation translation = new MapMarkerTranslation();
        translation.setMarkerId(source.getId());
        translation.setLanguage(language);
        translation.setTitle(title);
        translation.setDescription(description);
        translation.setSourceHash(MarkerSourceHash.of(source));
        return translations.saveAndFlush(translation);
    }

    private static MapMarker marker() {
        MapMarker marker = new MapMarker();
        marker.setLat(22.3);
        marker.setLng(114.2);
        marker.setCategory("friendly_clinic");
        marker.setTitle("中文诊所");
        marker.setDescription("中文描述");
        marker.setUsername("owner");
        marker.setUserPublicId("owner-public-id");
        return marker;
    }

    private static MarkerEditProposal proposal(MapMarker marker, String language, String title) {
        MarkerEditProposal proposal = new MarkerEditProposal();
        proposal.setMarkerId(marker.getId());
        proposal.setBaseMarkerVersion(marker.getVersion());
        proposal.setMarkerTitle(marker.getTitle());
        proposal.setMarkerLat(marker.getLat());
        proposal.setMarkerLng(marker.getLng());
        proposal.setProposerUsername("editor");
        proposal.setProposerPublicId("editor-public-id");
        proposal.setCategory("baby_room");
        proposal.setTitle(title);
        proposal.setDescription("Translated description");
        proposal.setLanguage(language);
        return proposal;
    }

    private static MockHttpSession reviewer() {
        MockHttpSession session = new MockHttpSession();
        session.setAttribute("username", "admin");
        return session;
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class JsonConfiguration {
        @Bean ObjectMapper objectMapper() { return new ObjectMapper().findAndRegisterModules(); }
    }
}
