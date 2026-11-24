package com.zhanibekakhmetov.temelo.server;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Map;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.media.MediaType;

import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.scheduling.annotation.EnableScheduling;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * Application-wide beans: the clock, scheduling, and the OpenAPI description
 * served at {@code /v3/api-docs} and as Swagger UI at {@code /swagger-ui.html}.
 */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
class ServerConfiguration {

	/** The one source of "now", so tests can move time instead of waiting for it. */
	@Bean
	Clock clock() {
		return Clock.systemUTC();
	}

	@Bean
	OpenAPI temeloOpenApi() {
		return new OpenAPI().info(new Info().title("Temelo server")
			.version("v1")
			.description("The optional web service behind Temelo, a local-first timetable app. The app works "
					+ "without it; the service exists to share a timetable as a link.")
			.license(new License().name("MIT").url("https://opensource.org/license/mit")));
	}

	/**
	 * Puts a real {@code .temelo} file — written by the app's own export code —
	 * in the description as the example for uploading and fetching a share, so
	 * Swagger UI's "Try it out" sends something the server accepts.
	 */
	@Bean
	OpenApiCustomizer exampleTimetableCustomizer(
			@Value("classpath:openapi/example-timetable.temelo") Resource exampleFile) {
		Map<String, Object> example = readJsonObject(exampleFile);
		return (openApi) -> {
			PathItem shares = openApi.getPaths().get("/api/shares");
			if (shares != null && shares.getPost() != null && shares.getPost().getRequestBody() != null) {
				setExample(shares.getPost().getRequestBody().getContent().get("application/json"), example);
			}
			PathItem share = openApi.getPaths().get("/api/shares/{id}");
			if (share != null && share.getGet() != null) {
				setExample(share.getGet().getResponses().get("200").getContent().get("application/json"), example);
			}
		};
	}

	private static void setExample(MediaType mediaType, Map<String, Object> example) {
		if (mediaType != null) {
			mediaType.setExample(example);
		}
	}

	private static Map<String, Object> readJsonObject(Resource resource) {
		try {
			return JsonMapper.shared().readValue(resource.getContentAsString(StandardCharsets.UTF_8),
					new TypeReference<Map<String, Object>>() {
					});
		}
		catch (IOException ex) {
			throw new UncheckedIOException("Could not read " + resource, ex);
		}
	}

}
