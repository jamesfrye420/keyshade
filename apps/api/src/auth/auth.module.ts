import { Module } from '@nestjs/common'
import { AuthService } from './service/auth.service'
import { AuthController } from './controller/auth.controller'
import { JwtModule } from '@nestjs/jwt'
import { UserModule } from '../user/user.module'
import { GithubStrategy } from '../config/oauth-strategy/github/github.strategy'
import { GithubOAuthStrategyFactory } from '../config/factory/github/github-strategy.factory'
import { GoogleOAuthStrategyFactory } from '../config/factory/google/google-strategy.factory'
import { GoogleStrategy } from '../config/oauth-strategy/google/google.strategy'
import { GitlabOAuthStrategyFactory } from '../config/factory/gitlab/gitlab-strategy.factory'
import { GitlabStrategy } from '../config/oauth-strategy/gitlab/gitlab.strategy'
import { ConfigModule } from '@nestjs/config'

/* FIXME: The following module imports Config module as dependency to ensure that the env file is loaded before the 
intialization of JWT Module. Unfortunately it shall not be the case. If we remove Config module as a dependency then at the time of 
JWT verification we get an error:

Error: secretOrPrivateKey must have a value

This is most probably because the there are multiple isntances of the Auth moodule or the JWT module being created in which
the concurrent instances are not being passed the correct parameters. Example cases:

https://stackoverflow.com/questions/74199783/secretorprivatekey-must-have-a-value-in-nestjs-jwt

https://stackoverflow.com/questions/77853711/nestjs-jwtservice-throws-error-secretorprivatekey-must-have-a-value-not-due-to

https://stackoverflow.com/questions/76466982/getting-secretorprivatekey-must-have-a-value-error-in-nestjs-jwt-authenticatio


*/

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: '1d',
        issuer: 'keyshade.xyz',
        algorithm: 'HS256'
      }
    }),
    UserModule
  ],
  providers: [
    AuthService,
    GithubOAuthStrategyFactory,
    {
      provide: GithubStrategy,
      useFactory: (githubOAuthStrategyFactory: GithubOAuthStrategyFactory) => {
        githubOAuthStrategyFactory.createOAuthStrategy()
      },
      inject: [GithubOAuthStrategyFactory]
    },
    GoogleOAuthStrategyFactory,
    {
      provide: GoogleStrategy,
      useFactory: (googleOAuthStrategyFactory: GoogleOAuthStrategyFactory) => {
        googleOAuthStrategyFactory.createOAuthStrategy()
      },
      inject: [GoogleOAuthStrategyFactory]
    },
    GitlabOAuthStrategyFactory,
    {
      provide: GitlabStrategy,
      useFactory: (gitlabOAuthStrategyFactory: GitlabOAuthStrategyFactory) => {
        gitlabOAuthStrategyFactory.createOAuthStrategy()
      },
      inject: [GitlabOAuthStrategyFactory]
    }
  ],
  controllers: [AuthController],
  exports: [AuthService]
})
export class AuthModule {}
