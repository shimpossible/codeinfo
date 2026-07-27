#!/usr/bin/python3

import json
import io
import sys

def covert_file(in_file):
    result = ''
    with open(in_file,'r') as f:
        d = json.load(f)
        
        for f in d.get('files'):
            result += ('{\n')
            result +=('  "uri": "' + f['file'] + '",\n')
            result +=('  "coverage":[\n')
            
            func_table = {}

            for fn in f.get('functions'):
                func_table[fn['name']] = fn

            lines = []
            for line in f.get('lines'):
                txt = '{\n'
                txt += '  "line": ' + str(line['line_number']) + ',\n'
                txt += '  "executed": ' + str(line['count']) + ',\n'
                txt += '  "branches": ['
                branches = ','.join( [ str(branch['count']) for branch in line['branches']] )
                txt += branches
                txt += ('],\n')

                fn = func_table.get( line['function_name'])
                txt += '  "scope": "'+ fn['demangled_name'] + '"\n'
                txt += ('}')
                lines.append(txt)
        result +=( ',\n'.join(lines))
        result += (']}')
    return result

with open("coverage.json",'w') as out:

    out.write("[\n")
    files = []
    for in_file in sys.argv[1:]:
        files.append(covert_file(in_file))

    out.write( ',\n'.join(files) + '\n')
    out.write(']')