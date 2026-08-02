# CodeInfo

The CodeInfo extension lets you view code coverage and advanced problem reports.  This reads in data from configured json files.

## Features

* Diagnostic
  Populate the "Problems" tab with warnings, errors and hits including "related info" below each problem
* Covverage
  Color your source with full,partial,none code coverage markings

## Requirements

You must generate your coverage report in json format.  This can be via gcov or other tool of your choice

## Extension Settings

This extension contributes the following settings:

* `codeinfo.coverage.enable`: Enable/disable display of code coverage.
* `codeinfo.coverage.fullDark`: Dark theme Color to use for full code coverage.
* `codeinfo.coverage.partDark`: Dark theme Color to use for partial code coverage.
* `codeinfo.coverage.nonnDark`: Dark theme Color to use for no code coverage.
* `codeinfo.coverage.fullLight`: Light theme Color to use for full code coverage.
* `codeinfo.coverage.partLight`: Light theme Color to use for partial code coverage.
* `codeinfo.coverage.nonnLight`: Light theme Color to use for no code coverage.
* `codeinfo.coverage.paths`: Array of paths to coverage file and baseDir to use for relative paths. `[{"baseDir":"", "path":"coverage.json"}]`

Coverage file should folow the format:
```
[
  {
    "url": "main.cpp", // Source file for code coverage 
    "coverage": [      // array of coverage data
      "line": 1,       // 1 base line number
      "executed": 1,   // how many times times this was executed.  0 means no code coverage
      "branches": [0,1],  // Optional. how many times each branch was executed.  Any 0 will be partial coverage
      "scope": ""         // Name of containing function (including template parameter)
    ]
  },
  { // another file
      ...
  }
]
```

* `codeinfo.disagnostic.paths`: Array of path and baseDir used to fill Problems tab.  `[{"baseDir":"", "path":"diag.json"}]`

Diagnostic file should have the following format:
```
{
  "main.cpp": [  // path to file with problems
    {
      "message": "",  // message to show in problems tab
      "line": 1,      // 1 based row number for problem
      "offset": 1,    // 1 based column number for problem
      "severity": "", // one of error, warning, info, hint
      "related":[     // optional list for additional info to show under problem
        "message": "",  // message for additioanl info
        "path": "",     // path for additional info
        "line": 1,      // 1 based row number   
        "offset": 1,    // 1 based column number
      ]
    }
  ]
}
```

## Known Issues

Coverage may not updated correctly when splitting editor windows. Select editor to refresh coverage display

## Release Notes

This is the first release and includes Code Coverage and Diagnostic reports
### 0.0.1

Initial release