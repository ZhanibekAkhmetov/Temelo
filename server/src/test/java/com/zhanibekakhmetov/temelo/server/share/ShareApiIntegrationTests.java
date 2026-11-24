package com.zhanibekakhmetov.temelo.server.share;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.node.ObjectNode;

import com.zhanibekakhmetov.temelo.server.MutableClock;
import com.zhanibekakhmetov.temelo.server.TestcontainersConfiguration;

/**
 * Sharing a timetable end to end: HTTP in, PostgreSQL in Docker, HTTP out —
 * with Flyway's schema, the real validator and a clock the tests move to see
 * links expire. Needs a running Docker daemon.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import({ TestcontainersConfiguration.class, ShareApiIntegrationTests.TestClock.class })
class ShareApiIntegrationTests {

	private static final Instant START = Instant.parse("2026-11-24T09:00:00Z");

	private static final Duration TTL = Duration.ofDays(14);

	@TestConfiguration(proxyBeanMethods = false)
	static class TestClock {

		@Bean
		@Primary
		MutableClock testClock() {
			return new MutableClock(START);
		}

	}

	@Autowired
	private MockMvc mvc;

	@Autowired
	private MutableClock clock;

	@Autowired
	private JdbcTemplate jdbc;

	@Autowired
	private ShareService shares;

	@BeforeEach
	void startFresh() {
		this.clock.set(START);
		this.jdbc.update("DELETE FROM shared_timetables");
	}

	@Test
	void aSharedFileComesBackByteForByte() throws Exception {
		String id = share(ExampleTimetable.bytes());

		byte[] fetched = this.mvc.perform(get("/api/shares/" + id))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsByteArray();
		assertThat(fetched).isEqualTo(ExampleTimetable.bytes());
	}

	@Test
	void nonAsciiTextSurvivesTheRoundTrip() throws Exception {
		byte[] body = ExampleTimetable.edited((root) -> ((ObjectNode) ExampleTimetable.snapshot(root).get("timetable"))
			.put("name", "Stundenplan für Übungen – 時間割 🧮"));
		String id = share(body);

		byte[] fetched = this.mvc.perform(get("/api/shares/" + id))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsByteArray();
		assertThat(fetched).isEqualTo(body);
		assertThat(new String(fetched, StandardCharsets.UTF_8)).contains("Stundenplan für Übungen – 時間割 🧮");
	}

	@Test
	void aShareIsOneRowWithItsSizeAndExpiry() throws Exception {
		byte[] body = ExampleTimetable.bytes();
		String response = this.mvc
			.perform(post("/api/shares").contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isCreated())
			.andExpect(jsonPath("$.expiresAt").value("2026-12-08T09:00:00Z"))
			.andReturn()
			.getResponse()
			.getContentAsString();
		String id = JsonPath.read(response, "$.id");

		Map<String, Object> row = this.jdbc.queryForMap("SELECT * FROM shared_timetables WHERE id = ?", id);
		assertThat(row.get("size_bytes")).isEqualTo(body.length);
		assertThat(((Timestamp) row.get("created_at")).toInstant()).isEqualTo(START);
		assertThat(((Timestamp) row.get("expires_at")).toInstant()).isEqualTo(START.plus(TTL));
		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM shared_timetables", Integer.class)).isEqualTo(1);
	}

	@Test
	void idsAreUnguessableAndDistinct() throws Exception {
		String first = share(ExampleTimetable.bytes());
		String second = share(ExampleTimetable.bytes());

		assertThat(first).isNotEqualTo(second);
		assertThat(first).hasSize(22).matches("[A-Za-z0-9_-]+");
		assertThat(second).hasSize(22).matches("[A-Za-z0-9_-]+");
	}

	@Test
	void aLinkWorksUntilItExpiresAndNotAMomentLonger() throws Exception {
		String id = share(ExampleTimetable.bytes());

		this.clock.advance(TTL.minusSeconds(1));
		this.mvc.perform(get("/api/shares/" + id)).andExpect(status().isOk());

		this.clock.advance(Duration.ofSeconds(1));
		this.mvc.perform(get("/api/shares/" + id))
			.andExpect(status().isNotFound())
			.andExpect(jsonPath("$.reason").value("not-found"));
	}

	@Test
	void anExpiredLinkLooksExactlyLikeOneThatNeverExisted() throws Exception {
		String id = share(ExampleTimetable.bytes());
		this.clock.advance(TTL);

		String expired = this.mvc.perform(get("/api/shares/" + id)).andReturn().getResponse().getContentAsString();
		String unknown = this.mvc.perform(get("/api/shares/AAAAAAAAAAAAAAAAAAAAAA"))
			.andReturn()
			.getResponse()
			.getContentAsString();
		assertThat(expired.replace(id, "ID")).isEqualTo(unknown.replace("AAAAAAAAAAAAAAAAAAAAAA", "ID"));
	}

	@Test
	void aMalformedIdIsNotFoundWithoutAQuery() throws Exception {
		this.mvc.perform(get("/api/shares/not-an-id")).andExpect(status().isNotFound());
		this.mvc.perform(get("/api/shares/' OR '1'='1")).andExpect(status().isNotFound());
	}

	@Test
	void thePurgeDeletesExpiredSharesAndOnlyThem() throws Exception {
		String older = share(ExampleTimetable.bytes());
		this.clock.advance(Duration.ofDays(7));
		String newer = share(ExampleTimetable.bytes());
		this.clock.advance(Duration.ofDays(7));

		assertThat(this.shares.purgeExpired()).isEqualTo(1);
		assertThat(this.jdbc.queryForList("SELECT id FROM shared_timetables", String.class)).containsExactly(newer);
		this.mvc.perform(get("/api/shares/" + older)).andExpect(status().isNotFound());
		this.mvc.perform(get("/api/shares/" + newer)).andExpect(status().isOk());
	}

	@Test
	void aRefusedUploadStoresNothing() throws Exception {
		byte[] newer = ExampleTimetable.edited((root) -> root.put("formatVersion", 2));
		this.mvc.perform(post("/api/shares").contentType(MediaType.APPLICATION_JSON).content(newer))
			.andExpect(status().isUnprocessableContent())
			.andExpect(jsonPath("$.reason").value("unsupported-version"));
		this.mvc.perform(post("/api/shares").contentType(MediaType.APPLICATION_JSON).content("not json"))
			.andExpect(status().isUnprocessableContent())
			.andExpect(jsonPath("$.reason").value("not-temelo"));

		assertThat(this.jdbc.queryForObject("SELECT count(*) FROM shared_timetables", Integer.class)).isZero();
	}

	@Test
	void theSchemaComesFromFlyway() {
		Map<String, Object> migration = this.jdbc
			.queryForMap("SELECT version, description, success FROM flyway_schema_history WHERE version = '1'");
		assertThat(migration.get("description")).isEqualTo("create shared timetables");
		assertThat(migration.get("success")).isEqualTo(true);
	}

	@Test
	void theDatabaseRefusesARowThatExpiresBeforeItIsCreated() {
		assertThatThrownBy(() -> this.jdbc.update(
				"INSERT INTO shared_timetables (id, envelope, size_bytes, created_at, expires_at) VALUES (?, '{}', 2, ?, ?)",
				"BBBBBBBBBBBBBBBBBBBBBB", Timestamp.from(START), Timestamp.from(START)))
			.isInstanceOf(DataIntegrityViolationException.class);
	}

	@Test
	void theOpenApiDescriptionCoversTheShareApi() throws Exception {
		this.mvc.perform(get("/v3/api-docs"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.info.title").value("Temelo server"))
			.andExpect(jsonPath("$.paths['/api/shares'].post.responses['201']").exists())
			.andExpect(jsonPath("$.paths['/api/shares'].post.responses['413']").exists())
			.andExpect(jsonPath("$.paths['/api/shares'].post.responses['422']").exists())
			.andExpect(jsonPath("$.paths['/api/shares/{id}'].get.responses['404']").exists())
			.andExpect(jsonPath("$.paths['/api/health'].get").exists())
			.andExpect(jsonPath("$.components.schemas.TemeloTimetableFile").exists());
	}

	@Test
	void theDocumentedExampleIsAFileTheServerAccepts() throws Exception {
		String docs = this.mvc.perform(get("/v3/api-docs")).andReturn().getResponse().getContentAsString();
		Map<String, Object> example = JsonPath.read(docs,
				"$.paths['/api/shares'].post.requestBody.content['application/json'].example");
		assertThat(example).containsEntry("type", "temelo-timetable");

		byte[] body = tools.jackson.databind.json.JsonMapper.shared().writeValueAsBytes(example);
		this.mvc.perform(post("/api/shares").contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isCreated());
	}

	@Test
	void swaggerUiIsServed() throws Exception {
		this.mvc.perform(get("/swagger-ui.html"))
			.andExpect(status().is3xxRedirection())
			.andExpect(redirectedUrl("/swagger-ui/index.html"));
		this.mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
	}

	private String share(byte[] body) throws Exception {
		String response = this.mvc
			.perform(post("/api/shares").contentType(MediaType.APPLICATION_JSON).content(body))
			.andExpect(status().isCreated())
			.andReturn()
			.getResponse()
			.getContentAsString();
		return JsonPath.read(response, "$.id");
	}

}
