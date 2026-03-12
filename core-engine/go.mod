module core-engine

go 1.26.1

require (
	dca-bot/core-engine/application/orchestrator v0.0.0
	dca-bot/core-engine/domain/config v0.0.0
	dca-bot/core-engine/domain/position v0.0.0
	github.com/shopspring/decimal v1.4.0
)

require (
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	github.com/stretchr/testify v1.8.4 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace (
	dca-bot/core-engine/application/orchestrator => ./application/orchestrator
	dca-bot/core-engine/domain/config => ./domain/config
	dca-bot/core-engine/domain/position => ./domain/position
)
