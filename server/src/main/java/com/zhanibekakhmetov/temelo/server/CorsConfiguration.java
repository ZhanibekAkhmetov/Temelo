package com.zhanibekakhmetov.temelo.server;

import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Lets the web app call the API from its own origin.
 *
 * The web app is served from a different origin than the server — another
 * port while developing, another host once deployed — so the browser asks
 * first (a preflight for the JSON POST) and only lets the page read an answer
 * that names its origin. The allowed origins are configuration
 * ({@code temelo.cors.allowed-origins}), never {@code *}: the API has no
 * cookies to protect, but a listed origin documents exactly who the API is
 * for. The phone app is not a browser and is not subject to CORS at all.
 */
@Configuration(proxyBeanMethods = false)
class CorsConfiguration implements WebMvcConfigurer {

	private final List<String> allowedOrigins;

	CorsConfiguration(@Value("${temelo.cors.allowed-origins}") List<String> allowedOrigins) {
		this.allowedOrigins = allowedOrigins.stream().map(String::trim).filter((origin) -> !origin.isEmpty()).toList();
	}

	@Override
	public void addCorsMappings(CorsRegistry registry) {
		registry.addMapping("/api/**")
			.allowedOrigins(this.allowedOrigins.toArray(String[]::new))
			.allowedMethods("GET", "POST")
			.allowedHeaders("Content-Type")
			.allowCredentials(false)
			.maxAge(3600);
	}

}
