package com.zhanibekakhmetov.temelo.server.health;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Connection;
import java.sql.SQLException;

import javax.sql.DataSource;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The health endpoint on its own, with the database replaced by a mock — the
 * only way to see the "down" answers, since a real database that is down also
 * stops the application from starting.
 */
@WebMvcTest(HealthController.class)
class HealthControllerTests {

	@Autowired
	private MockMvc mvc;

	@MockitoBean
	private DataSource dataSource;

	private final Connection connection = mock(Connection.class);

	@Test
	void upWhenTheDatabaseAnswers() throws Exception {
		given(this.dataSource.getConnection()).willReturn(this.connection);
		given(this.connection.isValid(anyInt())).willReturn(true);

		this.mvc.perform(get("/api/health"))
			.andExpect(status().isOk())
			.andExpect(jsonPath("$.status").value("UP"))
			.andExpect(jsonPath("$.database").value("UP"))
			.andExpect(header().string("Cache-Control", "no-store"));
	}

	@Test
	void downWhenTheConnectionIsNotValid() throws Exception {
		given(this.dataSource.getConnection()).willReturn(this.connection);
		given(this.connection.isValid(anyInt())).willReturn(false);

		this.mvc.perform(get("/api/health"))
			.andExpect(status().isServiceUnavailable())
			.andExpect(jsonPath("$.status").value("DOWN"))
			.andExpect(jsonPath("$.database").value("DOWN"));
	}

	@Test
	void downWhenNoConnectionCanBeOpened() throws Exception {
		given(this.dataSource.getConnection()).willThrow(new SQLException("Connection refused"));

		this.mvc.perform(get("/api/health"))
			.andExpect(status().isServiceUnavailable())
			.andExpect(jsonPath("$.status").value("DOWN"))
			.andExpect(jsonPath("$.database").value("DOWN"));
	}

	@Test
	void theAnswerNamesNoErrorDetail() throws Exception {
		given(this.dataSource.getConnection()).willThrow(new SQLException("password authentication failed"));

		this.mvc.perform(get("/api/health"))
			.andExpect(status().isServiceUnavailable())
			.andExpect(jsonPath("$.length()").value(2))
			.andExpect(jsonPath("$.error").doesNotExist());
	}

}
