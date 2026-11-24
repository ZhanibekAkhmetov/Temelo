package com.zhanibekakhmetov.temelo.server;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The browser's side of the conversation: the web app's origin may call the
 * API, any other origin may not. Two origins are configured here to check
 * that the list is split, not taken as one string.
 */
@SpringBootTest(properties = "temelo.cors.allowed-origins=http://localhost:8081, https://temelo.example")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class CorsTests {

	@Autowired
	private MockMvc mvc;

	@Test
	void theWebAppMayPostAShare() throws Exception {
		this.mvc
			.perform(options("/api/shares").header(HttpHeaders.ORIGIN, "https://temelo.example")
				.header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
				.header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "content-type"))
			.andExpect(status().isOk())
			.andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "https://temelo.example"))
			.andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS, "GET,POST"))
			.andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS));
	}

	@Test
	void theWebAppMayReadAShare() throws Exception {
		this.mvc.perform(get("/api/shares/AAAAAAAAAAAAAAAAAAAAAA").header(HttpHeaders.ORIGIN, "http://localhost:8081"))
			.andExpect(status().isNotFound())
			.andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:8081"));
	}

	@Test
	void anyOtherOriginIsRefused() throws Exception {
		this.mvc
			.perform(options("/api/shares").header(HttpHeaders.ORIGIN, "https://somewhere-else.example")
				.header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST"))
			.andExpect(status().isForbidden())
			.andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
	}

	@Test
	void otherMethodsAreNotOffered() throws Exception {
		this.mvc
			.perform(options("/api/shares/AAAAAAAAAAAAAAAAAAAAAA").header(HttpHeaders.ORIGIN, "http://localhost:8081")
				.header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "DELETE"))
			.andExpect(status().isForbidden());
	}

}
