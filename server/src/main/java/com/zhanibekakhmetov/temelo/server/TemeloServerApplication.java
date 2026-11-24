package com.zhanibekakhmetov.temelo.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class TemeloServerApplication {

	public static void main(String[] args) {
		SpringApplication.run(TemeloServerApplication.class, args);
	}

}
