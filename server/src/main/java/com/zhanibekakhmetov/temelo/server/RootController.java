package com.zhanibekakhmetov.temelo.server;

import java.net.URI;

import io.swagger.v3.oas.annotations.Hidden;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sends someone who opens the server's bare address to the API documentation
 * instead of a 404 — the server has no page of its own, and Swagger UI is what
 * there is to see. Relative, so it stays right behind a proxy that terminates
 * HTTPS. Not part of the API, so not in its description.
 */
@Hidden
@RestController
class RootController {

	@GetMapping("/")
	ResponseEntity<Void> root() {
		return ResponseEntity.status(HttpStatus.FOUND).location(URI.create("/swagger-ui.html")).build();
	}

}
