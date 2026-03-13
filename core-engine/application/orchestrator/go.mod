module dca-bot/core-engine/application/orchestrator

go 1.22

require (
	dca-bot/core-engine/domain/config v0.0.0
	dca-bot/core-engine/domain/position v0.0.0
	github.com/shopspring/decimal v1.3.1
	github.com/stretchr/testify v1.8.4
)

require (
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace (
	dca-bot/core-engine/domain/config => ../../domain/config
	dca-bot/core-engine/domain/position => ../../domain/position
)
