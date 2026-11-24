package com.zhanibekakhmetov.temelo.server;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The whole application against a real PostgreSQL in Docker: the context
 * starts, Flyway and Hibernate accept the database, and the health endpoint
 * reaches it. Needs a running Docker daemon.
 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
@AutoConfigureMockMvc
class TemeloServerApplicationTests {

	@Autowired
	private MockMvc mvc;

	@Autowired
	private JdbcTemplate jdbc;

	@Test
	void runsAgainstThePostgresImageTheComposeFileUses() {
		String version = this.jdbc.queryForObject("SHOW server_version", String.class);
		String expectedMajor = TestcontainersConfiguration.POSTGRES_IMAGE.getVersionPart().split("[.-]")[0];
		assertThat(version).startsWith(expectedMajor + ".");
	}

	@Test
	void healthIsUpWithTheDatabaseRunning() throws Exception {
		this.mvc.perform(get("/api/health"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("UP"))
			.andExpect(jsonPath("$.database").value("UP"));
	}

	@Test
	void theBareAddressLeadsToTheApiDocumentation() throws Exception {
		this.mvc.perform(get("/"))
			.andExpect(status().isFound())
			.andExpect(header().string("Location", "/swagger-ui.html"));
	}

	@Test
	void theRedirectIsNotPartOfTheApiDescription() throws Exception {
		this.mvc.perform(get("/v3/api-docs")).andExpect(jsonPath("$.paths['/']").doesNotExist());
	}

	@Test
	void unknownPathsAreNotFound() throws Exception {
		this.mvc.perform(get("/api/no-such-endpoint")).andExpect(status().isNotFound());
	}

}
