package com.routecatch.api.auth.controller;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.routecatch.api.auth.dto.AuthResponse;
import com.routecatch.api.auth.dto.LoginRequest;
import com.routecatch.api.auth.dto.RegisterRequest;
import com.routecatch.api.auth.dto.UserResponse;
import com.routecatch.api.auth.service.AuthService;
import com.routecatch.api.auth.service.CurrentUserService;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

	private final AuthService authService;
	private final CurrentUserService currentUserService;

	public AuthController(
		AuthService authService,
		CurrentUserService currentUserService
	) {
		this.authService = authService;
		this.currentUserService = currentUserService;
	}

	@PostMapping("/register")
	public AuthResponse register(@Valid @RequestBody RegisterRequest request) {
		return authService.register(request);
	}

	@PostMapping("/login")
	public AuthResponse login(@Valid @RequestBody LoginRequest request) {
		return authService.login(request);
	}

	@GetMapping("/me")
	public UserResponse me(Authentication authentication) {
		return currentUserService.getCurrentUser(authentication);
	}
}
