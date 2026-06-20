package com.routecatch.api.auth.service;

import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

import com.routecatch.api.auth.dto.UserResponse;
import com.routecatch.api.auth.persistence.UserEntity;

@Service
public class CurrentUserService {

	public UserResponse getCurrentUser(Authentication authentication) {
		return UserResponse.from((UserEntity) authentication.getPrincipal());
	}
}
