package com.zhanibekakhmetov.temelo.server.share;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.never;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.Optional;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.zhanibekakhmetov.temelo.server.share.EnvelopeRejectedException.Reason;

/**
 * The HTTP contract of the share API, with the service mocked: status codes,
 * headers, the size limit, and the problem details every refusal becomes.
 * The limit is lowered to 4 KB here so it can be crossed cheaply; the example
 * file is about 2.8 KB.
 */
@WebMvcTest(value = ShareController.class, properties = "temelo.share.max-size=4KB")
@Import(ShareControllerTests.Properties.class)
class ShareControllerTests {

	private static final String ID = "o2Gx0b5cQd2u8rT1yKz3Aw";

	private static final Instant CREATED = Instant.parse("2026-11-24T09:00:00Z");

	private static final Instant EXPIRES = Instant.parse("2026-12-08T09:00:00Z");

	@TestConfiguration
	@EnableConfigurationProperties(ShareProperties.class)
	static class Properties {

	}

	@Autowired
	private MockMvc mvc;

	@MockitoBean
	private ShareService shares;

	@Test
	void sharingAnswersCreatedWithTheIdAndExpiry() throws Exception {
		byte[] body = ExampleTimetable.bytes();
		given(this.shares.create(body)).willReturn(new SharedTimetable(ID, "{}", body.length, CREATED, EXPIRES));

		this.mvc.perform(post("/api/shares").contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isCreated())
			.andExpect(header().string("Location", "/api/shares/" + ID))
			.andExpect(header().string("Cache-Control", "no-store"))
			.andExpect(jsonPath("$.id").value(ID))
			.andExpect(jsonPath("$.expiresAt").value("2026-12-08T09:00:00Z"));
	}

	@Test
	void anUploadOverTheLimitIsRefusedWithoutReachingTheService() throws Exception {
		byte[] body = new byte[4 * 1024 + 1];

		this.mvc.perform(post("/api/shares").contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isContentTooLarge())
			.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
			.andExpect(jsonPath("$.reason").value("too-large"));
		then(this.shares).should(never()).create(any());
	}

	@Test
	void anUploadAtTheLimitIsAccepted() throws Exception {
		byte[] body = new byte[4 * 1024];
		given(this.shares.create(body)).willReturn(new SharedTimetable(ID, "{}", body.length, CREATED, EXPIRES));

		this.mvc.perform(post("/api/shares").contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isCreated());
	}

	@Test
	void onlyJsonIsAccepted() throws Exception {
		this.mvc.perform(post("/api/shares").contentType(MediaType.TEXT_PLAIN).content(ExampleTimetable.bytes()))
			.andExpect(status().isUnsupportedMediaType())
			.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
		then(this.shares).should(never()).create(any());
	}

	@Test
	void aRejectedEnvelopeBecomesAProblemWithItsReason() throws Exception {
		given(this.shares.create(any())).willThrow(
				new EnvelopeRejectedException(Reason.UNSUPPORTED_VERSION, "File format 2 is newer than 1."));

		this.mvc.perform(post("/api/shares").contentType(MediaType.APPLICATION_JSON).content("{}"))
			.andExpect(status().isUnprocessableContent())
			.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
			.andExpect(jsonPath("$.status").value(422))
			.andExpect(jsonPath("$.title").value("Unsupported Temelo file version"))
			.andExpect(jsonPath("$.detail").value("File format 2 is newer than 1."))
			.andExpect(jsonPath("$.reason").value("unsupported-version"));
	}

	@Test
	void eachReasonHasItsOwnStatus() throws Exception {
		for (Reason reason : Reason.values()) {
			willThrow(new EnvelopeRejectedException(reason, "detail")).given(this.shares).create(any());
			this.mvc.perform(post("/api/shares").contentType(MediaType.APPLICATION_JSON).content("{}"))
				.andExpect(status().is(reason.status().value()))
				.andExpect(jsonPath("$.reason").value(reason.code()));
		}
	}

	@Test
	void fetchingReturnsTheFileAsStored() throws Exception {
		String envelope = ExampleTimetable.text();
		given(this.shares.findEnvelope(ID)).willReturn(Optional.of(envelope));

		this.mvc.perform(get("/api/shares/" + ID))
			.andExpect(status().isOk())
			.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
			.andExpect(header().string("Cache-Control", "no-store"))
			.andExpect(content().string(envelope));
	}

	@Test
	void anUnknownOrExpiredShareIsNotFound() throws Exception {
		given(this.shares.findEnvelope(ID)).willReturn(Optional.empty());

		this.mvc.perform(get("/api/shares/" + ID))
			.andExpect(status().isNotFound())
			.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
			.andExpect(jsonPath("$.reason").value("not-found"));
	}

}
