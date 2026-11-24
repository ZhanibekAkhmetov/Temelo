package com.zhanibekakhmetov.temelo.server;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * A throwaway PostgreSQL for the tests, and for {@link TestTemeloServerApplication}.
 *
 * <p>{@code @ServiceConnection} points the application's datasource at the
 * container, so the credentials in {@code application.properties} are not used.
 * The image is the one {@code compose.yaml} runs for development; keep the two
 * in step.
 */
@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

	public static final DockerImageName POSTGRES_IMAGE = DockerImageName.parse("postgres:18-alpine");

	@Bean
	@ServiceConnection
	PostgreSQLContainer postgresContainer() {
		return new PostgreSQLContainer(POSTGRES_IMAGE);
	}

}
