import configparser

from aspace import client

def is_note_type(note_type: str):
    """
    Returns a function that compares the ['type'] of a note dict to the
    specified note type.

    Example:
    ```
    note = {'type': 'physloc'}
    assert is_note_type('physloc')(note)
    ```
    """
    def _is_note_type(note: dict) -> bool:
        return note.get('type') == note_type
    return _is_note_type

def main():
    config = configparser.ConfigParser()
    config.read('settings.ini')

    ASPACE = client.ASpaceClient(
        api_host=config['DEFAULT']['HOST'],
        username=config['DEFAULT']['USER'],
        password=config['DEFAULT']['PASS']
    )

    for resource in ASPACE.stream_records().resources():
        resource_changed = False

        #
        # Unpublish Physloc Notes
        #
        physloc_notes = filter(
            is_note_type('physloc'), 
            resource['notes']
        )

        for note in physloc_notes:
            if note['publish']:
                note['publish'] = False
                resource_changed = True

        #
        # Remove Langmaterial Notes
        #
        langmaterial_notes = list(filter(
            is_note_type('langmaterial'),
            resource['notes']
        ))

        for note in langmaterial_notes: 
            resource['notes'].remove(note)
            resource_changed = True

        #
        # Update
        #
        if (resource_changed):
            resp = ASPACE.post(resource['uri'], json=resource)
            print(resp.json())
        else:
            print('Resource OK:', resource['uri'])
        

if __name__ == '__main__':
    main()