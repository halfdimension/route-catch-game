package com.routecatch.api.auth.exception;

public class InvalidCredentialsException extends RuntimeException {

	public InvalidCredentialsException() {
		super("Invalid username/email or password");
	}
}
