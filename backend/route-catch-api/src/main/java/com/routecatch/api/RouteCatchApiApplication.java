package com.routecatch.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class RouteCatchApiApplication {

	public static void main(String[] args) {
		SpringApplication.run(RouteCatchApiApplication.class, args);
	}

}
