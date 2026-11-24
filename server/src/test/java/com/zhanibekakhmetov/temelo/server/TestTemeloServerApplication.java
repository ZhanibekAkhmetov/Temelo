package com.zhanibekakhmetov.temelo.server;

import org.springframework.boot.SpringApplication;

public class TestTemeloServerApplication {

	public static void main(String[] args) {
		SpringApplication.from(TemeloServerApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
