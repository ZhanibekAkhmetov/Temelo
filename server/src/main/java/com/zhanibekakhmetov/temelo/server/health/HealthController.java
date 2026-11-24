package com.zhanibekakhmetov.temelo.server.health;

import java.sql.Connection;
import java.sql.SQLException;

import javax.sql.DataSource;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Reports whether the server can do its job, which for a share-link service
 * means whether it can reach its database.
 *
 * <p>{@code 200} with {@code "UP"} when it can, {@code 503} with {@code "DOWN"}
 * when it cannot, so a load balancer or a container health check can act on
 * the status code alone. The body names no host, version or error: it is
 * public, and a stranger needs nothing more than up or down.
 */
@RestController
@Tag(name = "Health", description = "Whether the server can reach its database.")
class HealthController {

	private static final Logger log = LoggerFactory.getLogger(HealthController.class);

	/** How long {@link Connection#isValid(int)} may wait for the database. */
	private static final int VALIDATION_TIMEOUT_SECONDS = 2;

	private final DataSource dataSource;

	HealthController(DataSource dataSource) {
		this.dataSource = dataSource;
	}

	@GetMapping("/api/health")
	@Operation(summary = "Check the server",
			description = "200 with UP when the database answers, 503 with DOWN when it does not.")
	ResponseEntity<HealthResponse> health() {
		HealthResponse.Status database = databaseReachable() ? HealthResponse.Status.UP : HealthResponse.Status.DOWN;
		HttpStatus httpStatus = database == HealthResponse.Status.UP ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
		return ResponseEntity.status(httpStatus)
			.cacheControl(CacheControl.noStore())
			.body(new HealthResponse(database, database));
	}

	private boolean databaseReachable() {
		try (Connection connection = this.dataSource.getConnection()) {
			return connection.isValid(VALIDATION_TIMEOUT_SECONDS);
		}
		catch (SQLException ex) {
			log.warn("Health check could not reach the database: {}", ex.getMessage());
			return false;
		}
	}

}
